import { MongoClient, ObjectId } from 'mongodb';
import axios from 'axios';
import * as cheerio from 'cheerio';
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
        let documentType = 'unknown';
        
        if (url.endsWith('.pdf')) {
            // Handle PDF documents
            console.log('Processing PDF document...');
            const response = await axios.get(url, { 
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                }
            });
            
            const pdfData = await pdf(response.data);
            content = pdfData.text;
            
            // Extract title from URL or first line of content
            title = url.split('/').pop().replace('.pdf', '') || 'PDF Document';
            if (content.length > 100) {
                const firstLine = content.split('\n')[0].trim();
                if (firstLine.length > 10 && firstLine.length < 200) {
                    title = firstLine;
                }
            }
            
            documentType = 'pdf';
            
        } else if (url.includes('normattiva.it')) {
            // Handle Normattiva documents
            console.log('Processing Normattiva document...');
            const response = await axios.get(url, { 
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                }
            });
            
            const $ = cheerio.load(response.data);
            
            // Extract title
            title = $('title').text().trim() || 'Normattiva Document';
            
            // Extract content from various possible containers
            const contentSelectors = [
                '.art-content',
                '.articolo-content', 
                '.norma-content',
                'article',
                '.content',
                'main'
            ];
            
            for (const selector of contentSelectors) {
                const element = $(selector);
                if (element.length > 0 && element.text().trim().length > 100) {
                    content = element.text().trim();
                    break;
                }
            }
            
            documentType = 'normattiva';
            
        } else {
            // Handle generic web pages
            console.log('Processing web page...');
            const response = await axios.get(url, { 
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                }
            });
            
            const $ = cheerio.load(response.data);
            
            // Extract title
            title = $('title').text().trim() || $('h1').first().text().trim() || 'Web Document';
            
            // Extract main content
            const contentSelectors = [
                'main',
                'article', 
                '.content',
                '.main-content',
                'body'
            ];
            
            for (const selector of contentSelectors) {
                const element = $(selector);
                if (element.length > 0 && element.text().trim().length > 100) {
                    content = element.text().trim();
                    break;
                }
            }
            
            documentType = 'web';
        }

        // Clean up content
        content = content
            .replace(/\s+/g, ' ')
            .replace(/\n\s*\n/g, '\n')
            .trim();

        if (content.length < 100) {
            return res.status(400).json({ 
                success: false, 
                error: 'Document content too short or extraction failed',
                extractedLength: content.length
            });
        }

        // Store in MongoDB
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        const db = client.db('urbanai');
        const documentsCollection = db.collection('documents');
        
        // Check if document already exists
        const existingDoc = await documentsCollection.findOne({ url: url });
        if (existingDoc) {
            await client.close();
            return res.status(200).json({
                success: true,
                message: 'Document already exists',
                documentId: existingDoc._id.toString(),
                title: existingDoc.title,
                contentLength: existingDoc.content.length
            });
        }

        const document = {
            url: url,
            title: title,
            content: content,
            source: source,
            documentType: documentType,
            contentLength: content.length,
            createdAt: new Date(),
            processed: false,
            embedded: false
        };

        const result = await documentsCollection.insertOne(document);
        await client.close();

        console.log(`Document stored with ID: ${result.insertedId}`);

        return res.status(200).json({
            success: true,
            documentId: result.insertedId.toString(),
            title: title,
            contentLength: content.length,
            documentType: documentType,
            message: 'Document scraped and stored successfully'
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