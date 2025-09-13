import { MongoClient } from 'mongodb';
import axios from 'axios';
import pdf from 'pdf-parse';

const MONGODB_URI = process.env.MONGODB_URI;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { url, source = 'manual' } = req.body;
    
    if (!url) {
        return res.status(400).json({ success: false, error: 'URL is required' });
    }

    try {
        console.log(`Scraping URL: ${url}`);
        
        let content = '';
        let title = '';
        
        if (url.endsWith('.pdf')) {
            const response = await axios.get(url, { 
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
                }
            });
            
            const pdfData = await pdf(response.data);
            content = pdfData.text;
            title = url.split('/').pop().replace('.pdf', '') || 'PDF Document';
            
            if (content.length > 100) {
                const firstLine = content.split('\n')[0].trim();
                if (firstLine.length > 10 && firstLine.length < 200) {
                    title = firstLine;
                }
            }
        }

        content = content.replace(/\s+/g, ' ').trim();

        if (content.length < 50) {
            return res.status(400).json({ 
                success: false, 
                error: 'Document content too short',
                extractedLength: content.length
            });
        }

        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        const db = client.db('urbanai');
        const documentsCollection = db.collection('documents');
        
        const existingDoc = await documentsCollection.findOne({ url: url });
        if (existingDoc) {
            await client.close();
            return res.status(200).json({
                success: true,
                message: 'Document already exists',
                documentId: existingDoc._id.toString(),
                title: existingDoc.title
            });
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

        return res.status(200).json({
            success: true,
            documentId: result.insertedId.toString(),
            title: title,
            contentLength: content.length,
            message: 'Document scraped successfully'
        });

    } catch (error) {
        console.error('Scraping error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to scrape document',
            message: error.message
        });
    }
}