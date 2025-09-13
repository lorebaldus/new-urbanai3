export default function handler(req, res) {
    res.status(200).json({ 
        success: true, 
        message: 'Test endpoint works!',
        method: req.method,
        timestamp: new Date().toISOString()
    });
}