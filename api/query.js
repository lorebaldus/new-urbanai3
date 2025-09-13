import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'urbanai';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { question } = req.body;
    
    if (!question || question.trim().length === 0) {
        return res.status(400).json({ 
            success: false, 
            error: 'Question is required' 
        });
    }

    try {
        console.log(`Processing query: ${question}`);
        console.log(`OpenAI API Key present: ${!!OPENAI_API_KEY}`);
        console.log(`OpenAI API Key length: ${OPENAI_API_KEY?.length || 'undefined'}`);

        // Generate embedding for the question
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-ada-002',
            input: question.trim(),
        });
        
        const queryEmbedding = embeddingResponse.data[0].embedding;
        
        // Search in Pinecone
        const index = pinecone.index(PINECONE_INDEX_NAME);
        const searchResponse = await index.query({
            vector: queryEmbedding,
            topK: 5,
            includeMetadata: true,
            includeValues: false
        });

        let context = '';
        let sourcesFound = 0;
        let knowledgeBaseUsed = false;

        if (searchResponse.matches && searchResponse.matches.length > 0) {
            console.log(`Found ${searchResponse.matches.length} relevant documents`);
            knowledgeBaseUsed = true;
            sourcesFound = searchResponse.matches.length;
            
            // Build context from relevant documents
            const relevantTexts = searchResponse.matches
                .filter(match => match.score > 0.7) // Only use highly relevant matches
                .slice(0, 3) // Limit to top 3 matches
                .map(match => match.metadata.text)
                .join('\n\n');
            
            context = relevantTexts;
        }

        // Generate response using OpenAI with context
        let systemPrompt = `Sei UrbanAI, un assistente esperto in urbanistica, edilizia e normative italiane. 
Rispondi in modo professionale, pratico e preciso. Usa terminologia tecnica quando appropriato ma spiega i concetti complessi.
Concentrati su aspetti pratici come permessi, distanze, vincoli, zonizzazione e procedure amministrative.
Se non hai informazioni specifiche, fornisci comunque orientamenti generali utili.`;

        let userPrompt = question;

        if (context && context.length > 100) {
            systemPrompt += `\n\nUtilizza le seguenti informazioni dalla Gazzetta Ufficiale quando rilevanti:\n\n${context}`;
            userPrompt += '\n\nBasa la risposta sulle normative ufficiali quando possibile.';
        }

        const completionResponse = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            max_tokens: 800,
            temperature: 0.3
        });

        const answer = completionResponse.choices[0].message.content;

        console.log(`Generated response length: ${answer.length} characters`);

        return res.status(200).json({
            success: true,
            answer: answer,
            knowledgeBaseUsed: knowledgeBaseUsed,
            sourcesFound: sourcesFound,
            contextUsed: context.length > 0
        });

    } catch (error) {
        console.error('Query processing error:', error);
        
        // Return a more helpful error response
        return res.status(500).json({
            success: false,
            error: 'Errore del server',
            message: 'Problema temporaneo con il servizio AI. Riprova tra qualche istante.',
            fallback: true
        });
    }
}