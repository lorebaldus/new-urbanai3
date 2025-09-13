// Combined endpoint for all UrbanAI operations
import { MongoClient, ObjectId } from 'mongodb';
import axios from 'axios';

const MONGODB_URI = process.env.MONGODB_URI;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { action, ...params } = req.body;
    
    try {
        switch (action) {
            case 'scrape':
                return await handleScrape(req, res, params);
            case 'process':
                return await handleProcess(req, res, params);
            case 'embed':
                return await handleEmbed(req, res, params);
            case 'bulk-scrape':
                return await handleBulkScrape(req, res, params);
            case 'admin':
                return await handleAdmin(req, res, params);
            case 'test':
                return res.status(200).json({
                    success: true,
                    message: 'All-in-one endpoint working',
                    availableActions: ['scrape', 'process', 'embed', 'bulk-scrape', 'admin', 'test']
                });
            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid action',
                    availableActions: ['scrape', 'process', 'embed', 'bulk-scrape', 'admin', 'test']
                });
        }
    } catch (error) {
        console.error('All-in-one endpoint error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
}

async function handleScrape(req, res, params) {
    const { url, source = 'manual' } = params;
    
    if (!url) {
        return res.status(400).json({ success: false, error: 'URL is required' });
    }

    try {
        // Simple URL fetch for PDFs
        if (url.endsWith('.pdf')) {
            const response = await axios.get(url, { 
                timeout: 10000,
                headers: { 'User-Agent': 'UrbanAI/1.0' },
                responseType: 'arraybuffer'
            });
            
            // Mock processing for now - store basic info
            const client = new MongoClient(MONGODB_URI);
            await client.connect();
            const db = client.db('urbanai');
            const documentsCollection = db.collection('documents');
            
            const document = {
                url: url,
                title: url.split('/').pop().replace('.pdf', ''),
                content: 'PDF content placeholder',
                source: source,
                documentType: 'pdf',
                contentLength: response.data.length,
                createdAt: new Date(),
                processed: false,
                embedded: false
            };

            const result = await documentsCollection.insertOne(document);
            await client.close();

            return res.status(200).json({
                success: true,
                documentId: result.insertedId.toString(),
                title: document.title,
                contentLength: document.contentLength,
                message: 'PDF document scraped successfully'
            });
        }

        return res.status(400).json({ success: false, error: 'Only PDF URLs supported in simplified mode' });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'Failed to scrape document',
            message: error.message
        });
    }
}

async function handleProcess(req, res, params) {
    return res.status(200).json({
        success: true,
        message: 'Process functionality - placeholder',
        chunks: 5
    });
}

async function handleEmbed(req, res, params) {
    return res.status(200).json({
        success: true,
        message: 'Embed functionality - placeholder',
        embedded: true
    });
}

async function handleBulkScrape(req, res, params) {
    const { year = 2024, source = 'regioni', action = 'scrape' } = params;
    
    if (action === 'scrape') {
        // Simplified bulk scrape - find a few test PDFs
        const testUrls = [
            'https://www.gazzettaufficiale.it/do/atto/serie_generale/caricaPdf?cdImg=24A0485000100010110001&dgu=2024-08-07&art.dataPubblicazioneGazzetta=2024-08-07&art.codiceRedazionale=24A04850&art.num=1&art.tiposerie=SG',
            'https://www.gazzettaufficiale.it/do/atto/serie_generale/caricaPdf?cdImg=24A0485100100010110001&dgu=2024-08-07&art.dataPubblicazioneGazzetta=2024-08-07&art.codiceRedazionale=24A04851&art.num=1&art.tiposerie=SG'
        ];
        
        return res.status(200).json({
            success: true,
            source: `gazzetta_${source}`,
            year: year,
            totalFound: testUrls.length,
            processed: 0,
            remaining: testUrls.length,
            testUrls: testUrls,
            message: `Found ${testUrls.length} test documents for year ${year}`
        });
    }
    
    return res.status(400).json({ success: false, error: 'Invalid bulk-scrape action' });
}

async function handleAdmin(req, res, params) {
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        const db = client.db('urbanai');
        const documentsCollection = db.collection('documents');
        
        const totalDocuments = await documentsCollection.countDocuments();
        const processedDocuments = await documentsCollection.countDocuments({ processed: true });
        const embeddedDocuments = await documentsCollection.countDocuments({ embedded: true });
        
        await client.close();

        return res.status(200).json({
            success: true,
            statistics: {
                overview: {
                    totalDocuments,
                    processedDocuments,
                    embeddedDocuments,
                    completionRate: totalDocuments > 0 ? Math.round((processedDocuments / totalDocuments) * 100) : 0
                }
            },
            message: `System overview: ${totalDocuments} total documents`
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch statistics',
            message: error.message
        });
    }
}