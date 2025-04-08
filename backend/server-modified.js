// Import required dependencies
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { AzureKeyCredential } = require('@azure/core-auth');
const { OpenAIClient } = require('@azure/openai');
const { SearchClient } = require('@azure/search-documents');
const { sendDirectApiRequest } = require('./directAzureApi');
require('dotenv').config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Azure OpenAI deployment name
const DEPLOYMENT_NAME = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;

// Check for required environment variables
const requiredEnvVars = [
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_DEPLOYMENT_NAME',
  'AZURE_SEARCH_ENDPOINT',
  'AZURE_SEARCH_API_KEY',
  'AZURE_SEARCH_INDEX_NAME'
];

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`Error: Environment variable ${varName} is not set`);
    console.error(`Please check your .env file and make sure all required variables are set.`);
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

// Configure logging level
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const logLevels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

function log(level, ...args) {
  if (logLevels[level] >= logLevels[LOG_LEVEL]) {
    const timestamp = new Date().toISOString();
    console[level](`[${timestamp}] [${level.toUpperCase()}]`, ...args);
  }
}

// Azure OpenAI client
const client = new OpenAIClient(
  process.env.AZURE_OPENAI_ENDPOINT,
  new AzureKeyCredential(process.env.AZURE_OPENAI_API_KEY)
);

// Azure Search client (for direct testing)
const searchClient = new SearchClient(
  process.env.AZURE_SEARCH_ENDPOINT,
  process.env.AZURE_SEARCH_INDEX_NAME,
  new AzureKeyCredential(process.env.AZURE_SEARCH_API_KEY)
);

// Optimized system prompt (shortened to reduce token usage)
const SYSTEM_PROMPT = `Du bist ein präziser Recherche-Assistent, der NUR auf Deutsch antwortet und AUSSCHLIESSLICH Informationen aus den bereitgestellten Dokumenten verwendet.

Bei jeder Information musst du die genaue Quelle in Klammern direkt dahinter angeben. Format: (Quelle: Dokumentname, Seite X)

Gib nur kurze, präzise Antworten. Falls keine passenden Dokumente vorhanden sind, antworte: "In den verfügbaren Dokumenten konnte ich keine Informationen zu dieser Frage finden."`;

// API endpoint to handle chat requests
app.post('/api/chat', async (req, res) => {
  try {
    // Validate request body
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    log('info', `Neue Benutzeranfrage: "${message}"`);
    
    try {
      // For simplicity, we'll just use the manual search approach
      await handleChatWithManualSearch(message, res);
    } catch (innerError) {
      // Check if this is a rate limit error
      if (innerError.code === '429') {
        log('warn', 'Rate limit erreicht. Gebe freundliche Nachricht an Benutzer zurück.');
        return res.status(429).json({
          error: 'Anfragelimit erreicht',
          reply: 'Ich kann derzeit leider keine Antwort geben, da das Anfragelimit erreicht ist. Bitte versuchen Sie es in einigen Minuten erneut.',
          retry_after: '5 minutes'
        });
      }
      
      log('error', 'Fehler bei der Verarbeitung der Anfrage:', innerError);
      throw innerError;
    }
  } catch (error) {
    log('error', 'Fehler bei der Kommunikation mit der Azure OpenAI API:', error.message);
    
    // Provide more detailed error information for debugging
    if (error.response) {
      log('error', 'Response status:', error.response.status);
      log('error', 'Response data:', error.response.data);
    } else if (error.request) {
      log('error', 'Keine Antwort erhalten, Anfrage war:', error.request);
    } else {
      log('error', 'Fehler beim Einrichten der Anfrage:', error.message);
    }
    
    return res.status(500).json({ 
      error: 'Fehler bei der Antwort von Azure OpenAI API',
      details: error.message
    });
  }
});

/**
 * Verarbeitet Chat-Anfragen mit manueller Suche und reduziertem Kontext
 */
async function handleChatWithManualSearch(message, res) {
  try {
    log('debug', 'Starte Chat mit manueller Suche (optimiert)');
    
    // 1. Relevante Dokumente aus dem Suchindex abrufen (reduzierte Anzahl)
    const { contextText, documents } = await retrieveRelevantDocuments(message);
    
    // 2. Prüfen, ob Dokumente gefunden wurden
    if (documents.length === 0) {
      log('info', "Keine relevanten Dokumente gefunden");
      
      return res.json({
        reply: "In den verfügbaren Dokumenten konnte ich keine Informationen zu dieser Frage finden.",
        sources: []
      });
    }
    
    // 3. Prompt mit Kontext erstellen (kürzer)
    const userPrompt = `Frage: ${message}\nDokumentenkontext:\n${contextText}`;

    // 4. API-Anfrage an Azure OpenAI mit Retry-Mechanismus
    try {
      const result = await executeWithRetry(async () => {
        log('info', 'Sende Chat-Anfrage an Azure OpenAI');
        
        const requestPayload = {
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 400, // Reduziert für weniger Token-Verbrauch
          temperature: 0.1
        };
        
        return await client.getChatCompletions(
          DEPLOYMENT_NAME,
          requestPayload.messages,
          {
            maxTokens: requestPayload.max_tokens,
            temperature: requestPayload.temperature
          }
        );
      }, 3, 65000); // 3 Versuche, 65 Sekunden Wartezeit

      // Antwort verarbeiten
      const botReply = result.choices[0].message.content;
      log('info', `Bot-Antwort: "${botReply.substring(0, 100)}..."`);
      
      // Quellen extrahieren
      const sources = extractSourcesFromText(botReply);
      log('info', `${sources.length} eindeutige Quellen extrahiert`);
      
      return res.json({
        reply: botReply,
        sources: sources
      });
    } catch (apiError) {
      // Wenn alle Retries fehlschlagen
      if (apiError.code === '429') {
        throw apiError; // Rate-Limit-Fehler an den äußeren Handler weitergeben
      }
      
      // Bei anderen Fehlern
      log('error', 'Fehler bei der Chat-Anfrage:', apiError);
      
      return res.json({
        reply: "Es tut mir leid, aber ich kann derzeit keine Antwort generieren. Bitte versuchen Sie es später erneut.",
        error: apiError.message,
        sources: []
      });
    }
  } catch (error) {
    log('error', 'Fehler bei der manuellen Suche und Kontexterstellung:', error);
    throw error;
  }
}

/**
 * Führt eine Funktion mit automatischen Wiederholungsversuchen bei Rate-Limit-Fehlern aus
 */
async function executeWithRetry(fn, maxRetries = 3, retryDelay = 65000) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Nur bei Rate-Limit-Fehlern wiederholen
      if (error.code === '429') {
        if (attempt < maxRetries - 1) {
          const delayTime = retryDelay * (attempt + 1); // Progressive Verzögerung
          log('warn', `Rate limit erreicht. Warte ${delayTime / 1000} Sekunden vor erneutem Versuch (${attempt + 1}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, delayTime));
          continue;
        }
      } else {
        // Bei anderen Fehlern sofort abbrechen
        break;
      }
    }
  }
  
  // Wenn alle Versuche fehlschlagen
  throw lastError;
}

/**
 * Extrahiert Quellenangaben aus dem Text im Format (Quelle: Dokumentname, Seite X)
 */
function extractSourcesFromText(text) {
  const sources = [];
  const sourceRegex = /\(Quelle: ([^,]+), Seite (\d+)\)/g;
  let match;
  
  while ((match = sourceRegex.exec(text)) !== null) {
    const document = match[1].trim();
    const page = parseInt(match[2]);
    
    // Nur eindeutige Quellen hinzufügen
    if (!sources.some(s => s.document === document && s.page === page)) {
      sources.push({ document, page });
    }
  }
  
  return sources;
}

/**
 * Ruft relevante Dokumente aus dem Azure AI Search-Index ab (optimiert)
 */
async function retrieveRelevantDocuments(query) {
  log('debug', `Suche nach relevanten Dokumenten für: "${query}"`);
  
  try {
    // Optimierte Suchoptionen: Weniger Ergebnisse, keine semantische Suche
    const searchOptions = {
      select: ["content", "title", "filepath", "filename"],
      top: 3, // Reduziert von 15 auf 3
      queryType: "simple"
    };
    
    try {
      const searchResults = await searchClient.search(query, searchOptions);
      
      const results = [];
      let contextText = "";
      
      // Dokumentergebnisse verarbeiten (mit kürzerem Inhalt)
      for await (const result of searchResults.results) {
        if (!result.document) {
          continue;
        }
        
        try {
          // Feldnamen anpassen (passend zum Index)
          const doc = {
            content: result.document.content || "",
            documentName: result.document.filename || result.document.title || "Unbekanntes Dokument",
            pageNumber: result.document.filepath ? parseInt(result.document.filepath) || 1 : 1,
          };
          
          // Gekürzter Inhalt für den Kontext
          const trimmedContent = doc.content.length > 800 
            ? doc.content.substring(0, 800) + "..." 
            : doc.content;
          
          // Kontext für die Anfrage aufbauen (kürzer)
          contextText += `Dokument: ${doc.documentName}, S.${doc.pageNumber}: ${trimmedContent}\n\n`;
          
          results.push(doc);
        } catch (docError) {
          log('error', "Fehler beim Verarbeiten eines Dokumentergebnisses:", docError);
        }
      }
      
      log('info', `${results.length} relevante Dokumentenabschnitte gefunden`);
      
      return { contextText, documents: results };
      
    } catch (searchError) {
      log('error', "Fehler bei der Suche:", searchError);
      
      // Einfacher Fallback bei Fehlern
      return { contextText: "", documents: [] };
    }
  } catch (error) {
    log('error', "Kritischer Fehler beim Abrufen relevanter Dokumente:", error);
    
    // Leere Ergebnisse im Fehlerfall zurückgeben
    return { contextText: "", documents: [] };
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: 'Optimierte Version mit Ratenlimit-Behandlung'
  });
});

// Test search functionality
app.get('/api/test-search', async (req, res) => {
  try {
    const query = req.query.q || 'test query';
    const { documents } = await retrieveRelevantDocuments(query);
    
    return res.json({
      query,
      documentCount: documents.length,
      documents: documents.map(d => ({
        name: d.documentName,
        page: d.pageNumber,
        preview: d.content.substring(0, 100) + '...'
      }))
    });
  } catch (error) {
    console.error('Error testing search:', error);
    return res.status(500).json({ error: 'Error testing search', details: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT} (optimierte Version mit Ratenlimit-Behandlung)`);
  console.log(`System-Prompt konfiguriert mit ${SYSTEM_PROMPT.length} Zeichen (gekürzt)`);
  console.log(`Verwendetes Azure OpenAI-Deployment: ${DEPLOYMENT_NAME}`);
  console.log(`Verwendeter Azure AI Search-Index: ${process.env.AZURE_SEARCH_INDEX_NAME}`);
  console.log(`Gesundheitscheck verfügbar unter http://localhost:${PORT}/health`);
});