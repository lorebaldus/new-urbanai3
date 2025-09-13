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
        
        const totalDocuments = await documentsCollection.countDocuments();
        const processedDocuments = await documentsCollection.countDocuments({ processed: true });
        const embeddedDocuments = await documentsCollection.countDocuments({ embedded: true });
        
        const sourceStats = await documentsCollection.aggregate([
            {
                $group: {
                    _id: '$source',
                    total: { $sum: 1 },
                    processed: { $sum: { $cond: ['$processed', 1, 0] } },
                    embedded: { $sum: { $cond: ['$embedded', 1, 0] } }
                }
            }
        ]).toArray();
        
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
                },
                sourceBreakdown: sourceStats
            },
            message: `System: ${totalDocuments} docs, ${processedDocuments} processed (${completionRate}%)`
        });

    } catch (error) {
        console.error('Admin error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch statistics',
            message: error.message
        });
    }
}