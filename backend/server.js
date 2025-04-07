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

// Enhanced logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

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

// Enhanced system prompt with even stronger emphasis on citations
const SYSTEM_PROMPT = `Du bist ein präziser Recherche-Assistent, der NUR auf Deutsch antwortet und AUSSCHLIESSLICH Informationen aus den bereitgestellten Dokumenten verwendet.

WICHTIGSTE REGEL: Bei ABSOLUT JEDER Information MUSST du die genaue Quelle in Klammern direkt dahinter angeben. Format: (Quelle: Dokumentname, Seite X)

OHNE QUELLENANGABE DARFST DU KEINE INFORMATION NENNEN. Dies ist die wichtigste Regel und darf unter keinen Umständen ignoriert werden.

Beispiel für eine korrekte Antwort:
"Die BKB implementiert einen KI-Chatbot zur Verbesserung des Wissensmanagements. (Quelle: 2024_Safarik_Basler Kantonalbank_Bachelorarbeit, Seite 4) Kundenberater verbringen zwischen 5-12% ihrer Zeit mit Informationssuche. (Quelle: 2024_Safarik_Basler Kantonalbank_Bachelorarbeit, Seite 19)"

Formatierungsanweisungen:
1. Gliedere deine Antwort in klare Absätze
2. Stelle die wichtigsten Informationen an den Anfang
3. Falls die bereitgestellten Dokumente keine Antwort enthalten, sage deutlich: "In den verfügbaren Dokumenten konnte ich keine Informationen zu dieser Frage finden."
4. Verwende NIEMALS Erfindungen oder Informationen, die nicht in den Dokumenten stehen
5. Nenne bei JEDER Information die Quelle als (Quelle: Dokumentname, Seite X)

Die Angabe der Quellen ist VERPFLICHTEND für jede einzelne Information.`;

// API endpoint to handle chat requests
app.post('/api/chat', async (req, res) => {
  try {
    // Validate request body
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log(`Incoming user message: "${message}"`);

    // Configure request to Azure OpenAI API
    const apiUrl = `${azureEndpoint}openai/deployments/${deploymentName}/chat/completions?api-version=2023-05-15`;
    
    console.log(`Making request to Azure OpenAI API at: ${apiUrl}`);
    console.log(`Using deployment: ${deploymentName}`);
    
    const requestPayload = {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message }
      ],
      max_tokens: 800,
      temperature: 0.1, // Very low temperature for more deterministic responses
      top_p: 0.95,      // High top_p for more focused responses
      frequency_penalty: 0.0,
      presence_penalty: 0.0
    };
    
    console.log('Request payload prepared, sending to Azure...');
    
    const response = await axios.post(
      apiUrl,
      requestPayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        }
      }
    );

    console.log('Received response from Azure OpenAI API');
    
    // Ensure we got a valid response
    if (!response.data || !response.data.choices || response.data.choices.length === 0) {
      console.error('Invalid response structure:', response.data);
      return res.status(500).json({ 
        error: 'Invalid response from Azure OpenAI API', 
        details: 'The response did not contain expected data' 
      });
    }

    // Extract the bot's reply
    const botReply = response.data.choices[0].message.content;
    console.log(`Bot reply: "${botReply.substring(0, 100)}..."`);
    
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
    
    console.log(`Extracted ${sources.length} unique sources`);
    
    // Check if we need to enforce the citation requirement
    if (sources.length === 0 && botReply.length > 50 && !botReply.includes("keine Informationen zu dieser Frage finden")) {
      console.warn("Response contains no citations but provides information - requesting correction");
      
      // Make a follow-up request to correct the issue
      const correctionPayload = {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message },
          { role: 'assistant', content: botReply },
          { role: 'user', content: 'Deine Antwort enthält keine Quellenangaben. Bitte wiederhole die gleiche Antwort, aber füge bei jeder Information die Quelle mit Seitenzahl im Format (Quelle: Dokumentname, Seite X) hinzu.' }
        ],
        max_tokens: 800,
        temperature: 0.0 // Zero temperature for maximum determinism
      };
      
      const correctionResponse = await axios.post(
        apiUrl,
        correctionPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey
          }
        }
      );
      
      const correctedReply = correctionResponse.data.choices[0].message.content;
      console.log(`Corrected reply: "${correctedReply.substring(0, 100)}..."`);
      
      // Re-extract sources
      const correctedSources = [];
      while ((match = sourceRegex.exec(correctedReply)) !== null) {
        const document = match[1].trim();
        const page = parseInt(match[2]);
        
        if (!correctedSources.some(s => s.document === document && s.page === page)) {
          correctedSources.push({ document, page });
        }
      }
      
      return res.json({ 
        reply: correctedReply,
        sources: correctedSources
      });
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
    } else if (error.request) {
      console.error('No response received, request was:', error.request);
    } else {
      console.error('Error setting up request:', error.message);
    }
    
    return res.status(500).json({ 
      error: 'Failed to get response from Azure OpenAI API',
      details: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`System prompt configured with ${SYSTEM_PROMPT.length} characters`);
  console.log(`Using Azure OpenAI deployment: ${deploymentName}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
});
