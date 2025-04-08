// Import required dependencies
const express = require('express');
const cors = require('cors');
const { AzureKeyCredential } = require('@azure/core-auth');
const { OpenAIClient } = require('@azure/openai');
const { SearchClient } = require('@azure/search-documents');
require('dotenv').config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Azure OpenAI deployment name
const DEPLOYMENT_NAME = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;

// Middleware
app.use(cors());
app.use(express.json());

// Logger
function log(level, ...args) {
  const timestamp = new Date().toISOString();
  console[level](`[${timestamp}] [${level.toUpperCase()}]`, ...args);
}

// Azure OpenAI client
const client = new OpenAIClient(
  process.env.AZURE_OPENAI_ENDPOINT,
  new AzureKeyCredential(process.env.AZURE_OPENAI_API_KEY)
);

// Azure Search client
const searchClient = new SearchClient(
  process.env.AZURE_SEARCH_ENDPOINT,
  process.env.AZURE_SEARCH_INDEX_NAME,
  new AzureKeyCredential(process.env.AZURE_SEARCH_API_KEY)
);

// Extremely minimal system prompt
const SYSTEM_PROMPT = "Du bist ein Recherche-Assistent. Antworte knapp mit Quellenangaben.";

// API endpoint to handle chat requests
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    log('info', `Benutzeranfrage: "${message}"`);
    
    // Get only ONE document with EXTREME truncation
    try {
      const searchResults = await searchClient.search(message, {
        select: ["title", "filepath", "filename"],
        top: 1
      });
      
      const documents = [];
      let contextText = "";
      
      for await (const result of searchResults.results) {
        if (!result.document) continue;
        
        const docName = result.document.filename || result.document.title || "Unbekanntes Dokument";
        const pageNum = result.document.filepath ? parseInt(result.document.filepath) || 1 : 1;
        
        // EXTREME TRUNCATION - Don't even include content, just document reference
        contextText += `Dokument: ${docName}, Seite: ${pageNum}\n\n`;
        
        documents.push({
          documentName: docName,
          pageNumber: pageNum
        });
      }
      
      if (documents.length === 0) {
        return res.json({
          reply: "In den verfügbaren Dokumenten konnte ich keine Informationen zu dieser Frage finden.",
          sources: []
        });
      }
      
      // Create prompt with minimal context
      const userPrompt = `Frage: ${message.substring(0, 100)}\n\nIch kann folgende Dokumente finden, aber deren Inhalt nicht lesen: ${contextText}\n\nBitte antworte, dass du die Dokumente gefunden hast, aber momentan nicht auf deren Inhalt zugreifen kannst.`;
      
      const result = await client.getChatCompletions(
        DEPLOYMENT_NAME,
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        {
          maxTokens: 300,
          temperature: 0.7
        }
      );

      const botReply = result.choices[0].message.content;
      log('info', `Bot-Antwort: "${botReply.substring(0, 100)}..."`);
      
      return res.json({
        reply: botReply,
        sources: documents.map(d => ({ document: d.documentName, page: d.pageNumber }))
      });
    } catch (error) {
      log('error', 'Fehler bei der Suche:', error);
      throw error;
    }
  } catch (error) {
    log('error', 'Fehler:', error.message);
    
    return res.status(500).json({ 
      error: 'Fehler bei der Antwort',
      details: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: 'EXTREM-MODUS - Dokumenteninhalt komplett abgeschnitten'
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT} (EXTREM-MODUS - Dokumenteninhalt komplett abgeschnitten)`);
  console.log(`Gesundheitscheck verfügbar unter http://localhost:${PORT}/health`);
});