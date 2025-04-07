// Import required dependencies
const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Check for required environment variables
const requiredEnvVars = [
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_DEPLOYMENT_NAME'
];

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`Error: Environment variable ${varName} is not set`);
    process.exit(1);
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Normalize Azure OpenAI endpoint URL
const normalizeEndpoint = (endpoint) => {
  if (!endpoint.endsWith('/')) {
    return endpoint + '/';
  }
  return endpoint;
};

const azureEndpoint = normalizeEndpoint(process.env.AZURE_OPENAI_ENDPOINT);
const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
const apiKey = process.env.AZURE_OPENAI_API_KEY;

// API endpoint to handle chat requests
app.post('/api/chat', async (req, res) => {
  try {
    // Validate request body
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Configure request to Azure OpenAI API
    const apiUrl = `${azureEndpoint}openai/deployments/${deploymentName}/chat/completions?api-version=2023-05-15`;
    
    const response = await axios.post(
      apiUrl,
      {
        messages: [
          { 
            role: 'system', 
            content: `Du bist ein präziser Recherche-Assistent, der NUR auf Deutsch antwortet und Informationen ausschließlich aus den bereitgestellten Dokumenten verwendet.

WICHTIGSTE REGEL: Bei JEDER EINZELNEN Information, die du nennst, MUSST du die genaue Quelle in Klammern direkt dahinter angeben. Format: (Quelle: Dokumentname, Seite X)

Beispiel für eine korrekte Antwort:
"Die BKB implementiert einen KI-Chatbot zur Verbesserung des Wissensmanagements. (Quelle: 2024_Safarik_Basler Kantonalbank_Bachelorarbeit, Seite 4) Kundenberater verbringen zwischen 5-12% ihrer Zeit mit Informationssuche. (Quelle: 2024_Safarik_Basler Kantonalbank_Bachelorarbeit, Seite 19)"

Formatierungsanweisungen:
1. Gliedere deine Antwort in klare Absätze
2. Stelle die wichtigsten Informationen an den Anfang
3. Falls die bereitgestellten Dokumente keine Antwort enthalten, sage deutlich: "In den verfügbaren Dokumenten konnte ich keine Informationen zu dieser Frage finden."
4. Verwende NIEMALS Erfindungen oder Informationen, die nicht in den Dokumenten stehen
5. Nenne bei jeder Information die Quelle als (Quelle: Dokumentname, Seite X)

Diese Anweisungen sind von höchster Wichtigkeit und dürfen unter keinen Umständen ignoriert werden.`
          },
          { role: 'user', content: message }
        ],
        max_tokens: 800,
        temperature: 0.3 // Lower temperature for more consistent responses
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        }
      }
    );

    // Extract the bot's reply
    const botReply = response.data.choices[0].message.content;
    
    // Extract sources for additional metadata
    const sources = [];
    const sourceRegex = /\(Quelle: ([^,]+), Seite (\d+)\)/g;
    let match;
    
    while ((match = sourceRegex.exec(botReply)) !== null) {
      const document = match[1].trim();
      const page = parseInt(match[2]);
      
      // Only add unique sources
      if (!sources.some(s => s.document === document && s.page === page)) {
        sources.push({ document, page });
      }
    }
    
    return res.json({ 
      reply: botReply,
      sources: sources
    });
    
  } catch (error) {
    console.error('Error communicating with Azure OpenAI API:', error.message);
    
    // Provide more detailed error information for debugging
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    
    return res.status(500).json({ 
      error: 'Failed to get response from Azure OpenAI API',
      details: error.message
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});