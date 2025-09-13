import { MongoClient } from 'mongodb';
import axios from 'axios';
import * as cheerio from 'cheerio';

const MONGODB_URI = process.env.MONGODB_URI;
const VERCEL_URL = process.env.VERCEL_URL;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { source = 'regioni', year = 2024, action = 'scrape' } = req.body;
    
    try {
        // Get base URL for internal API calls
        const baseUrl = VERCEL_URL ? `https://${VERCEL_URL}` : 'https://new-urbanai3.vercel.app';
        
        if (action === 'scrape') {
            console.log(`Starting bulk scrape for ${source} year ${year}`);
            
            // Find PDFs for the specified year and source
            const pdfUrls = await findPdfsForYear(year, source);
            console.log(`Found ${pdfUrls.length} PDFs for year ${year}`);
            
            if (pdfUrls.length === 0) {
                return res.status(200).json({
                    success: true,
                    message: `No PDFs found for ${source} year ${year}`,
                    source: `gazzetta_${source}`,
                    totalFound: 0,
                    processed: 0
                });
            }

            // Process in very small batches to stay within timeout
            const batchSize = 5; // Much smaller batches to avoid timeout
            const processedResults = [];
            const maxDocuments = Math.min(pdfUrls.length, 10); // Limit total documents per request
            const documentsToProcess = pdfUrls.slice(0, maxDocuments);
            
            console.log(`Processing ${documentsToProcess.length} documents in batches of ${batchSize}`);
            
            for (let i = 0; i < documentsToProcess.length; i += batchSize) {
                const batch = documentsToProcess.slice(i, i + batchSize);
                console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(documentsToProcess.length/batchSize)} (${batch.length} documents)`);
                
                for (const pdfUrl of batch) {
                    try {
                        console.log(`Processing: ${pdfUrl}`);
                        
                        // Download and store document
                        const scrapeResponse = await fetch(`${baseUrl}/api/scrape`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                url: pdfUrl,
                                source: `gazzetta_${source}`
                            })
                        });
                        
                        if (!scrapeResponse.ok) {
                            console.log(`Scrape failed for ${pdfUrl}: ${scrapeResponse.status}`);
                            continue;
                        }
                        
                        const scrapeResult = await scrapeResponse.json();
                        if (!scrapeResult.success) {
                            console.log(`Scrape unsuccessful for ${pdfUrl}: ${scrapeResult.message}`);
                            continue;
                        }
                        
                        // Process document
                        const processResponse = await fetch(`${baseUrl}/api/process`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                documentId: scrapeResult.documentId 
                            })
                        });
                        
                        if (processResponse.ok) {
                            const processResult = await processResponse.json();
                            if (processResult.success) {
                                // Generate embeddings
                                const embedResponse = await fetch(`${baseUrl}/api/embed`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ 
                                        documentId: scrapeResult.documentId 
                                    })
                                });
                                
                                if (embedResponse.ok) {
                                    const embedResult = await embedResponse.json();
                                    processedResults.push({
                                        url: pdfUrl,
                                        documentId: scrapeResult.documentId,
                                        chunks: processResult.chunks,
                                        embedded: embedResult.success
                                    });
                                    console.log(`✅ Successfully processed: ${pdfUrl}`);
                                }
                            }
                        }
                        
                        // Small delay to avoid rate limiting
                        await new Promise(resolve => setTimeout(resolve, 200));
                        
                    } catch (error) {
                        console.error(`Error processing ${pdfUrl}:`, error);
                    }
                }
            }
            
            // Add information about remaining documents
            const remainingDocuments = pdfUrls.length - maxDocuments;
            if (remainingDocuments > 0) {
                console.log(`⏳ ${remainingDocuments} documents remaining to be processed in future batches`);
            }

            return res.status(200).json({
                success: true,
                source: `gazzetta_${source}`,
                year: year,
                totalFound: pdfUrls.length,
                processed: processedResults.length,
                remaining: remainingDocuments,
                results: processedResults.slice(0, 5), // Show first 5 for brevity
                message: `Processed ${processedResults.length} documents successfully. ${remainingDocuments} documents remain to be processed in future batches.`
            });
            
        } else if (action === 'stats') {
            // Get statistics from MongoDB
            const client = new MongoClient(MONGODB_URI);
            await client.connect();
            const db = client.db('urbanai');
            const documentsCollection = db.collection('documents');
            
            const totalDocuments = await documentsCollection.countDocuments({ 
                source: new RegExp(`gazzetta_${source}`) 
            });
            
            const processedDocuments = await documentsCollection.countDocuments({ 
                source: new RegExp(`gazzetta_${source}`),
                processed: true 
            });
            
            const embeddedDocuments = await documentsCollection.countDocuments({ 
                source: new RegExp(`gazzetta_${source}`),
                embedded: true 
            });
            
            await client.close();
            
            return res.status(200).json({
                success: true,
                statistics: {
                    source: source,
                    totalDocuments,
                    processedDocuments,
                    embeddedDocuments,
                    completionRate: totalDocuments > 0 ? Math.round((processedDocuments / totalDocuments) * 100) : 0
                }
            });
        }

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
        const urls = [];
        
        if (source === 'regioni') {
            // Form data for Gazzetta delle Regioni search
            const formData = new URLSearchParams();
            formData.append('_token', '');
            formData.append('numero', '');
            formData.append('anno', year.toString());
            formData.append('mese', '');
            formData.append('giorno', '');
            formData.append('sommario_numero', '');
            formData.append('sommario_anno', '');
            formData.append('sommario_mese', '');
            formData.append('sommario_giorno', '');
            formData.append('testo_articolo', '');
            formData.append('submit', 'Cerca');
            
            console.log(`Searching for PDFs in Gazzetta Regioni for year ${year}...`);
            
            const response = await axios.post(
                'https://www.gazzettaufficiale.it/ricerca/regioni/risultati',
                formData,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                    },
                    timeout: 30000
                }
            );
            
            if (response.status === 200) {
                const $ = cheerio.load(response.data);
                
                // Look for PDF links in search results
                $('a[href*=".pdf"]').each((i, element) => {
                    let pdfUrl = $(element).attr('href');
                    if (pdfUrl) {
                        if (pdfUrl.startsWith('/')) {
                            pdfUrl = 'https://www.gazzettaufficiale.it' + pdfUrl;
                        }
                        urls.push(pdfUrl);
                    }
                });
                
                console.log(`Found ${urls.length} PDF URLs for year ${year}`);
            }
        }
        
        // Remove duplicates
        return [...new Set(urls)];
        
    } catch (error) {
        console.error('Error finding PDFs:', error);
        return [];
    }
}