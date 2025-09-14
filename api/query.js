import { Pinecone } from '@pinecone-database/pinecone';
import { MongoClient } from 'mongodb';
import OpenAI from 'openai';
import axios from 'axios';
import * as cheerio from 'cheerio';
import pdf from 'pdf-parse';

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'urban-ai';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });

export default async function handler(req, res) {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { question, command, ...params } = req.body;
    
    try {
        // Handle special admin commands FIRST
        if (command) {
            console.log(`Handling command: ${command}`);
            switch (command) {
                case 'admin':
                    return await handleAdmin(req, res);
                case 'bulk-scrape':
                    return await handleBulkScrape(req, res, params);
                case 'scrape':
                    return await handleScrape(req, res, params);
                default:
                    return res.status(400).json({ success: false, error: 'Unknown command' });
            }
        }
        
        // Handle regular questions ONLY if no command
        if (!question || question.trim().length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Question or command is required' 
            });
        }

        console.log(`Processing query: ${question}`);

        // Generate embedding for the question
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-ada-002',
            input: question.trim(),
        });
        
        const queryEmbedding = embeddingResponse.data[0].embedding;
        
        // Search in Pinecone
        const index = pinecone.index(PINECONE_INDEX_NAME);
        const searchResponse = await index.query({
            vector: queryEmbedding,
            topK: 5,
            includeMetadata: true,
            includeValues: false
        });

        let context = '';
        let sourcesFound = 0;
        let knowledgeBaseUsed = false;

        if (searchResponse.matches && searchResponse.matches.length > 0) {
            console.log(`Found ${searchResponse.matches.length} relevant documents`);
            knowledgeBaseUsed = true;
            sourcesFound = searchResponse.matches.length;
            
            const relevantTexts = searchResponse.matches
                .filter(match => match.score > 0.7)
                .slice(0, 3)
                .map(match => match.metadata.text)
                .join('\n\n');
            
            context = relevantTexts;
        }

        // Generate response using OpenAI with context
        let systemPrompt = `Sei UrbanAI, un assistente esperto in urbanistica, edilizia e normative italiane. 
Rispondi in modo professionale, pratico e preciso. Usa terminologia tecnica quando appropriato ma spiega i concetti complessi.
Concentrati su aspetti pratici come permessi, distanze, vincoli, zonizzazione e procedure amministrative.
Se non hai informazioni specifiche, fornisci comunque orientamenti generali utili.`;

        let userPrompt = question;

        if (context && context.length > 100) {
            systemPrompt += `\n\nUtilizza le seguenti informazioni dalla Gazzetta Ufficiale quando rilevanti:\n\n${context}`;
            userPrompt += '\n\nBasa la risposta sulle normative ufficiali quando possibile.';
        }

        const completionResponse = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            max_tokens: 800,
            temperature: 0.3
        });

        const answer = completionResponse.choices[0].message.content;

        return res.status(200).json({
            success: true,
            answer: answer,
            knowledgeBaseUsed: knowledgeBaseUsed,
            sourcesFound: sourcesFound,
            contextUsed: context.length > 0
        });

    } catch (error) {
        console.error('Query processing error:', error);
        
        return res.status(500).json({
            success: false,
            error: 'Errore del server',
            message: 'Problema temporaneo con il servizio AI. Riprova tra qualche istante.',
            fallback: true
        });
    }
}

// Admin functionality
async function handleAdmin(req, res) {
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        const db = client.db('urbanai');
        const documentsCollection = db.collection('documents');
        
        const totalDocuments = await documentsCollection.countDocuments();
        const processedDocuments = await documentsCollection.countDocuments({ processed: true });
        const embeddedDocuments = await documentsCollection.countDocuments({ embedded: true });
        
        await client.close();

        const completionRate = totalDocuments > 0 ? Math.round((processedDocuments / totalDocuments) * 100) : 0;

        return res.status(200).json({
            success: true,
            statistics: {
                overview: {
                    totalDocuments,
                    processedDocuments,
                    embeddedDocuments,
                    completionRate
                }
            },
            message: `System: ${totalDocuments} docs, ${processedDocuments} processed (${completionRate}%)`
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch statistics',
            message: error.message
        });
    }
}

// Bulk scrape functionality
async function handleBulkScrape(req, res, params) {
    const { source = 'regioni', year = 2024 } = params;
    
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

        // Process 3 documents max per call to avoid timeout
        const maxDocs = Math.min(pdfUrls.length, 3);
        const docsToProcess = pdfUrls.slice(0, maxDocs);
        const processedResults = [];
        
        for (const pdfUrl of docsToProcess) {
            try {
                console.log(`Processing: ${pdfUrl}`);
                
                const scrapeResult = await scrapeSinglePDF(pdfUrl, `gazzetta_${source}`);
                if (scrapeResult.success) {
                    processedResults.push({
                        url: pdfUrl,
                        documentId: scrapeResult.documentId,
                        status: 'scraped'
                    });
                }
                
                await new Promise(resolve => setTimeout(resolve, 1000));
                
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
        return res.status(500).json({
            success: false,
            error: 'Bulk scrape failed',
            message: error.message
        });
    }
}

// Single scrape functionality  
async function handleScrape(req, res, params) {
    const { url, source = 'manual' } = params;
    
    if (!url) {
        return res.status(400).json({ success: false, error: 'URL is required' });
    }

    try {
        const result = await scrapeSinglePDF(url, source);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'Scrape failed',
            message: error.message
        });
    }
}

// Helper functions
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

async function scrapeSinglePDF(url, source) {
    const response = await axios.get(url, { 
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
        }
    });
    
    const pdfData = await pdf(response.data);
    const content = pdfData.text.replace(/\s+/g, ' ').trim();
    const title = url.split('/').pop().replace('.pdf', '') || 'PDF Document';

    if (content.length < 50) {
        throw new Error('Document content too short');
    }

    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db('urbanai');
    const documentsCollection = db.collection('documents');
    
    const existingDoc = await documentsCollection.findOne({ url: url });
    if (existingDoc) {
        await client.close();
        return {
            success: true,
            message: 'Document already exists',
            documentId: existingDoc._id.toString(),
            title: existingDoc.title
        };
    }

    const document = {
        url: url,
        title: title,
        content: content,
        source: source,
        documentType: 'pdf',
        contentLength: content.length,
        createdAt: new Date(),
        processed: false,
        embedded: false
    };

    const result = await documentsCollection.insertOne(document);
    await client.close();

    return {
        success: true,
        documentId: result.insertedId.toString(),
        title: title,
        contentLength: content.length,
        message: 'Document scraped successfully'
    };
}