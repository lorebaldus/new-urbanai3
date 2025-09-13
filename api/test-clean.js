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

    const { question } = req.body;
    
    console.log(`Test Clean API - Processing: ${question}`);

    const answer = `✅ FUNZIONA! Test Clean API risponde a: "${question}". Nessun OpenAI coinvolto!`;

    return res.status(200).json({
        success: true,
        answer: answer,
        knowledgeBaseUsed: false,
        sourcesFound: 0,
        contextUsed: false
    });
}