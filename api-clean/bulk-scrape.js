import { MongoClient } from 'mongodb';
import axios from 'axios';
import * as cheerio from 'cheerio';

const MONGODB_URI = process.env.MONGODB_URI;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { source = 'regioni', year = 2024, action = 'scrape' } = req.body;
    
    try {
        console.log(`Starting bulk scrape for ${source} year ${year}`);
        
        const pdfUrls = await findPdfsForYear(year, source);
        console.log(`Found ${pdfUrls.length} PDFs for year ${year}`);
        
        if (pdfUrls.length === 0) {
            return res.status(200).json({
                success: true,
                message: `No PDFs found for ${source} year ${year}`,
                totalFound: 0,
                processed: 0
            });
        }

        // Process 5 documents max per call to avoid timeout
        const maxDocs = Math.min(pdfUrls.length, 5);
        const docsToProcess = pdfUrls.slice(0, maxDocs);
        const processedResults = [];
        
        const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.headers.origin;
        
        for (const pdfUrl of docsToProcess) {
            try {
                console.log(`Processing: ${pdfUrl}`);
                
                const scrapeResponse = await fetch(`${baseUrl}/api/scrape`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        url: pdfUrl,
                        source: `gazzetta_${source}`
                    })
                });
                
                if (scrapeResponse.ok) {
                    const result = await scrapeResponse.json();
                    if (result.success) {
                        processedResults.push({
                            url: pdfUrl,
                            documentId: result.documentId,
                            status: 'scraped'
                        });
                    }
                }
                
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                console.error(`Error processing ${pdfUrl}:`, error);
            }
        }

        return res.status(200).json({
            success: true,
            year: year,
            totalFound: pdfUrls.length,
            processed: processedResults.length,
            remaining: pdfUrls.length - maxDocs,
            results: processedResults,
            message: `Processed ${processedResults.length} documents. ${pdfUrls.length - maxDocs} remaining.`
        });

    } catch (error) {
        console.error('Bulk scrape error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
}

async function findPdfsForYear(year, source = 'regioni') {
    try {
        const formData = new URLSearchParams();
        formData.append('anno', year.toString());
        formData.append('submit', 'Cerca');
        
        const response = await axios.post(
            'https://www.gazzettaufficiale.it/ricerca/regioni/risultati',
            formData,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
                },
                timeout: 15000
            }
        );
        
        if (response.status === 200) {
            const $ = cheerio.load(response.data);
            const urls = [];
            
            $('a[href*=".pdf"]').each((i, element) => {
                let pdfUrl = $(element).attr('href');
                if (pdfUrl) {
                    if (pdfUrl.startsWith('/')) {
                        pdfUrl = 'https://www.gazzettaufficiale.it' + pdfUrl;
                    }
                    urls.push(pdfUrl);
                }
            });
            
            return [...new Set(urls)];
        }
        
        return [];
        
    } catch (error) {
        console.error('Error finding PDFs:', error);
        return [];
    }
}