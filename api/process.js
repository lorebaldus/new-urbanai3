import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { documentId } = req.body;
    
    if (!documentId) {
        return res.status(400).json({ success: false, error: 'Document ID is required' });
    }

    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        const db = client.db('urbanai');
        const documentsCollection = db.collection('documents');
        
        // Get document
        const document = await documentsCollection.findOne({ 
            _id: new ObjectId(documentId) 
        });
        
        if (!document) {
            await client.close();
            return res.status(404).json({ 
                success: false, 
                error: 'Document not found' 
            });
        }

        if (document.processed) {
            await client.close();
            return res.status(200).json({
                success: true,
                message: 'Document already processed',
                chunks: document.chunks ? document.chunks.length : 0
            });
        }

        console.log(`Processing document: ${document.title}`);

        // Create chunks from content
        const chunks = await createChunks(document.content, document.title);
        
        if (chunks.length === 0) {
            await client.close();
            return res.status(400).json({
                success: false,
                error: 'No chunks could be created from document content'
            });
        }

        // Update document with chunks
        await documentsCollection.updateOne(
            { _id: new ObjectId(documentId) },
            { 
                $set: { 
                    chunks: chunks,
                    processed: true,
                    processedAt: new Date()
                } 
            }
        );

        await client.close();

        console.log(`Document processed: ${chunks.length} chunks created`);

        return res.status(200).json({
            success: true,
            documentId: documentId,
            chunks: chunks.length,
            message: `Document processed successfully into ${chunks.length} chunks`
        });

    } catch (error) {
        console.error('Processing error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to process document',
            message: error.message
        });
    }
}

async function createChunks(content, title) {
    const chunks = [];
    const chunkSize = 1000; // Characters per chunk
    const overlap = 200; // Character overlap between chunks
    
    // Clean and normalize content
    const cleanContent = content
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim();
    
    if (cleanContent.length < 50) {
        return chunks;
    }

    // Split content into sentences to avoid breaking mid-sentence
    const sentences = cleanContent.split(/(?<=[.!?])\s+/);
    
    let currentChunk = '';
    let chunkIndex = 0;
    
    for (const sentence of sentences) {
        const potentialChunk = currentChunk + (currentChunk ? ' ' : '') + sentence;
        
        if (potentialChunk.length <= chunkSize) {
            currentChunk = potentialChunk;
        } else {
            // Save current chunk if it's substantial
            if (currentChunk.length > 50) {
                chunks.push({
                    id: `chunk_${chunkIndex}`,
                    text: currentChunk.trim(),
                    index: chunkIndex,
                    length: currentChunk.length,
                    title: title
                });
                chunkIndex++;
            }
            
            // Start new chunk with overlap if possible
            const words = currentChunk.split(' ');
            const overlapWords = words.slice(-Math.floor(overlap / 6)); // Approximate word count for overlap
            const overlapText = overlapWords.join(' ');
            
            currentChunk = (overlapText.length < overlap ? overlapText + ' ' : '') + sentence;
        }
    }
    
    // Add the last chunk if it's substantial
    if (currentChunk.length > 50) {
        chunks.push({
            id: `chunk_${chunkIndex}`,
            text: currentChunk.trim(),
            index: chunkIndex,
            length: currentChunk.length,
            title: title
        });
    }
    
    return chunks;
}