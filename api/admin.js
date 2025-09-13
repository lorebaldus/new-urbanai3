import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        const db = client.db('urbanai');
        const documentsCollection = db.collection('documents');
        
        // Get comprehensive statistics
        const totalDocuments = await documentsCollection.countDocuments();
        const processedDocuments = await documentsCollection.countDocuments({ processed: true });
        const embeddedDocuments = await documentsCollection.countDocuments({ embedded: true });
        
        // Get statistics by source
        const sourceStats = await documentsCollection.aggregate([
            {
                $group: {
                    _id: '$source',
                    total: { $sum: 1 },
                    processed: { $sum: { $cond: ['$processed', 1, 0] } },
                    embedded: { $sum: { $cond: ['$embedded', 1, 0] } }
                }
            },
            { $sort: { total: -1 } }
        ]).toArray();
        
        // Get recent documents
        const recentDocuments = await documentsCollection.find({})
            .sort({ createdAt: -1 })
            .limit(10)
            .project({ 
                title: 1, 
                source: 1, 
                processed: 1, 
                embedded: 1, 
                createdAt: 1,
                contentLength: 1
            })
            .toArray();
        
        // Get chunk statistics
        const chunkStats = await documentsCollection.aggregate([
            { $match: { processed: true, chunks: { $exists: true } } },
            { $project: { chunkCount: { $size: '$chunks' } } },
            {
                $group: {
                    _id: null,
                    totalChunks: { $sum: '$chunkCount' },
                    avgChunksPerDoc: { $avg: '$chunkCount' },
                    maxChunksPerDoc: { $max: '$chunkCount' },
                    minChunksPerDoc: { $min: '$chunkCount' }
                }
            }
        ]).toArray();
        
        await client.close();

        const completionRate = totalDocuments > 0 ? Math.round((processedDocuments / totalDocuments) * 100) : 0;
        const embeddingRate = processedDocuments > 0 ? Math.round((embeddedDocuments / processedDocuments) * 100) : 0;

        return res.status(200).json({
            success: true,
            statistics: {
                overview: {
                    totalDocuments,
                    processedDocuments,
                    embeddedDocuments,
                    completionRate,
                    embeddingRate
                },
                chunks: chunkStats[0] || {
                    totalChunks: 0,
                    avgChunksPerDoc: 0,
                    maxChunksPerDoc: 0,
                    minChunksPerDoc: 0
                },
                sourceBreakdown: sourceStats,
                recentActivity: recentDocuments
            },
            message: `System overview: ${totalDocuments} total documents, ${processedDocuments} processed (${completionRate}%), ${embeddedDocuments} embedded (${embeddingRate}%)`
        });

    } catch (error) {
        console.error('Admin stats error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch statistics',
            message: error.message
        });
    }
}