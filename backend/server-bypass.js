// Import required dependencies
const express = require('express');
const cors = require('cors');
const { AzureKeyCredential } = require('@azure/core-auth');
const { OpenAIClient } = require('@azure/openai');
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

// Simple system prompt
const SYSTEM_PROMPT = "Du bist ein hilfreicher Assistent, der auf Deutsch antwortet.";

// API endpoint to handle chat requests
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    log('info', `Benutzeranfrage: "${message}"`);
    
    // EMERGENCY MODE: Skip document retrieval completely
    try {
      log('info', 'NOTFALLMODUS: Dokumentensuche übersprungen, direkte Antwort ohne Dokumente');
      
      const result = await client.getChatCompletions(
        DEPLOYMENT_NAME,
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `${message} (HINWEIS: Aufgrund eines technischen Problems kann ich derzeit nicht auf die Dokumente zugreifen. Bitte antworte allgemein, dass du momentan keine spezifischen Informationen aus den Dokumenten bereitstellen kannst, aber allgemeine Hilfe anbieten kannst.)` }
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
        sources: [],
        mode: "emergency"
      });
    } catch (error) {
      log('error', 'Fehler bei der direkten Anfrage:', error);
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
    message: 'NOTFALLMODUS - Dokumentenzugriff deaktiviert'
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT} (NOTFALLMODUS - Dokumentenzugriff deaktiviert)`);
  console.log(`WICHTIG: Dieser Modus umgeht die Dokumentensuche komplett!`);
  console.log(`Gesundheitscheck verfügbar unter http://localhost:${PORT}/health`);
});