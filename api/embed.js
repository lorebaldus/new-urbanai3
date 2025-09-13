import { MongoClient, ObjectId } from 'mongodb';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

const MONGODB_URI = process.env.MONGODB_URI;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'urbanai';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });

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

        if (!document.processed || !document.chunks) {
            await client.close();
            return res.status(400).json({ 
                success: false, 
                error: 'Document must be processed before embedding' 
            });
        }

        if (document.embedded) {
            await client.close();
            return res.status(200).json({
                success: true,
                message: 'Document already embedded',
                chunksEmbedded: document.chunks.length
            });
        }

        console.log(`Generating embeddings for document: ${document.title}`);

        const index = pinecone.index(PINECONE_INDEX_NAME);
        const vectors = [];
        
        // Process chunks in smaller batches to avoid rate limits
        const batchSize = 10;
        let embeddedCount = 0;
        
        for (let i = 0; i < document.chunks.length; i += batchSize) {
            const batch = document.chunks.slice(i, i + batchSize);
            console.log(`Processing embedding batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(document.chunks.length/batchSize)}`);
            
            for (const chunk of batch) {
                try {
                    // Generate embedding with OpenAI
                    const embeddingResponse = await openai.embeddings.create({
                        model: 'text-embedding-ada-002',
                        input: chunk.text,
                    });
                    
                    const embedding = embeddingResponse.data[0].embedding;
                    
                    // Prepare vector for Pinecone
                    const vector = {
                        id: `${documentId}_${chunk.id}`,
                        values: embedding,
                        metadata: {
                            documentId: documentId,
                            chunkId: chunk.id,
                            chunkIndex: chunk.index,
                            title: document.title,
                            source: document.source,
                            documentType: document.documentType,
                            url: document.url,
                            text: chunk.text.substring(0, 1000), // Truncate for metadata limits
                            createdAt: new Date().toISOString()
                        }
                    };
                    
                    vectors.push(vector);
                    embeddedCount++;
                    
                    // Small delay to respect rate limits
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (error) {
                    console.error(`Error embedding chunk ${chunk.id}:`, error);
                    // Continue with other chunks
                }
            }
            
            // Upload batch to Pinecone
            if (vectors.length > 0) {
                try {
                    await index.upsert(vectors);
                    console.log(`Uploaded ${vectors.length} vectors to Pinecone`);
                    vectors.length = 0; // Clear the array for next batch
                } catch (error) {
                    console.error('Error uploading to Pinecone:', error);
                }
            }
            
            // Delay between batches
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Update document as embedded
        await documentsCollection.updateOne(
            { _id: new ObjectId(documentId) },
            { 
                $set: { 
                    embedded: true,
                    embeddedAt: new Date(),
                    chunksEmbedded: embeddedCount
                } 
            }
        );

        await client.close();

        console.log(`Document embedded: ${embeddedCount} chunks processed`);

        return res.status(200).json({
            success: true,
            documentId: documentId,
            chunksEmbedded: embeddedCount,
            totalChunks: document.chunks.length,
            message: `Document embedded successfully: ${embeddedCount}/${document.chunks.length} chunks`
        });

    } catch (error) {
        console.error('Embedding error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to embed document',
            message: error.message
        });
    }
}