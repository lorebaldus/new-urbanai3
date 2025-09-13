import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const VERCEL_URL = process.env.VERCEL_URL;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { action = 'process', batchSize = 5 } = req.body;
    
    try {
        const baseUrl = VERCEL_URL ? `https://${VERCEL_URL}` : 'https://new-urbanai3.vercel.app';
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        const db = client.db('urbanai');
        
        if (action === 'process') {
            // Process next batch of unprocessed documents
            const documentsCollection = db.collection('documents');
            
            const unprocessedDocs = await documentsCollection.find({
                processed: false
            })
            .limit(batchSize)
            .toArray();
            
            if (unprocessedDocs.length === 0) {
                await client.close();
                return res.status(200).json({
                    success: true,
                    message: 'No unprocessed documents found',
                    processed: 0
                });
            }
            
            console.log(`Processing batch of ${unprocessedDocs.length} documents`);
            let processedCount = 0;
            
            for (const doc of unprocessedDocs) {
                try {
                    const processResponse = await fetch(`${baseUrl}/api/process`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            documentId: doc._id.toString()
                        })
                    });
                    
                    if (processResponse.ok) {
                        const result = await processResponse.json();
                        if (result.success) {
                            processedCount++;
                            console.log(`✅ Processed: ${doc.title}`);
                        }
                    }
                    
                    // Small delay between processing
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                } catch (error) {
                    console.error(`Error processing ${doc._id}:`, error);
                }
            }
            
            await client.close();
            
            return res.status(200).json({
                success: true,
                processed: processedCount,
                total: unprocessedDocs.length,
                message: `Processed ${processedCount}/${unprocessedDocs.length} documents`
            });
            
        } else if (action === 'embed') {
            // Embed next batch of processed but not embedded documents
            const documentsCollection = db.collection('documents');
            
            const unembeddedDocs = await documentsCollection.find({
                processed: true,
                embedded: false
            })
            .limit(batchSize)
            .toArray();
            
            if (unembeddedDocs.length === 0) {
                await client.close();
                return res.status(200).json({
                    success: true,
                    message: 'No unembedded documents found',
                    embedded: 0
                });
            }
            
            console.log(`Embedding batch of ${unembeddedDocs.length} documents`);
            let embeddedCount = 0;
            
            for (const doc of unembeddedDocs) {
                try {
                    const embedResponse = await fetch(`${baseUrl}/api/embed`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            documentId: doc._id.toString()
                        })
                    });
                    
                    if (embedResponse.ok) {
                        const result = await embedResponse.json();
                        if (result.success) {
                            embeddedCount++;
                            console.log(`✅ Embedded: ${doc.title}`);
                        }
                    }
                    
                    // Longer delay for embedding to respect API limits
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                } catch (error) {
                    console.error(`Error embedding ${doc._id}:`, error);
                }
            }
            
            await client.close();
            
            return res.status(200).json({
                success: true,
                embedded: embeddedCount,
                total: unembeddedDocs.length,
                message: `Embedded ${embeddedCount}/${unembeddedDocs.length} documents`
            });
            
        } else if (action === 'status') {
            // Get queue status
            const documentsCollection = db.collection('documents');
            
            const stats = await documentsCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        scraped: { $sum: { $cond: [{ $ne: ['$content', null] }, 1, 0] } },
                        processed: { $sum: { $cond: ['$processed', 1, 0] } },
                        embedded: { $sum: { $cond: ['$embedded', 1, 0] } },
                        unprocessed: { $sum: { $cond: [{ $and: [{ $ne: ['$content', null] }, { $eq: ['$processed', false] }] }, 1, 0] } },
                        unembedded: { $sum: { $cond: [{ $and: ['$processed', { $eq: ['$embedded', false] }] }, 1, 0] } }
                    }
                }
            ]).toArray();
            
            await client.close();
            
            const queueStatus = stats[0] || {
                total: 0,
                scraped: 0,
                processed: 0,
                embedded: 0,
                unprocessed: 0,
                unembedded: 0
            };
            
            return res.status(200).json({
                success: true,
                queueStatus,
                message: `Queue status: ${queueStatus.unprocessed} to process, ${queueStatus.unembedded} to embed`
            });
        }
        
    } catch (error) {
        console.error('Queue processor error:', error);
        return res.status(500).json({
            success: false,
            error: 'Queue processing failed',
            message: error.message
        });
    }
}