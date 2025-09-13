// Simplified scrape endpoint for testing
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { url, source = 'manual' } = req.body;
    
    if (!url) {
        return res.status(400).json({ success: false, error: 'URL is required' });
    }

    try {
        // Simple mock response for testing
        return res.status(200).json({
            success: true,
            documentId: 'test-' + Date.now(),
            title: 'Test Document',
            contentLength: 1000,
            documentType: 'test',
            message: 'Simplified scrape endpoint working',
            url: url,
            source: source
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