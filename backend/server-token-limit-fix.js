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

// Model token limits - adjust based on model
const MAX_MODEL_TOKENS = 16000; // For gpt-35-turbo-16k
const MAX_COMPLETION_TOKENS = 1000;
const AVAILABLE_CONTEXT_TOKENS = MAX_MODEL_TOKENS - MAX_COMPLETION_TOKENS;

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

// Extremely minimized system prompt
const SYSTEM_PROMPT = `Du bist ein Recherche-Assistent, der Informationen aus Dokumenten liefert. Gib zu jeder Information die Quelle an: (Quelle: Dokumentname, Seite X). Antworte kurz und präzise.`;

// Estimate tokens in a string (rough approximation: ~4 chars per token)
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

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
      // Use only the manual search approach with token control
      await handleChatWithTokenControl(message, res);
    } catch (innerError) {
      // Check if this is a token limit error
      if (innerError.message && innerError.message.includes('maximum context length')) {
        log('warn', 'Token-Limit überschritten. Sende Hinweis an Benutzer.');
        return res.status(413).json({
          error: 'Zu viele Dokumente',
          reply: 'Die Anfrage enthält zu viele Dokumente für die Verarbeitung. Bitte stellen Sie eine spezifischere Frage, um relevantere Dokumente zu erhalten.',
          retry_suggestion: 'Stellen Sie eine spezifischere Frage'
        });
      }
      
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
 * Verarbeitet Chat-Anfragen mit strikter Token-Begrenzung
 */
async function handleChatWithTokenControl(message, res) {
  try {
    log('debug', 'Starte Chat mit Token-Kontrolle');
    
    // 1. Relevante Dokumente aus dem Suchindex abrufen (stark reduzierte Anzahl)
    let { contextText, documents } = await retrieveRelevantDocumentsWithTokenLimit(message);
    
    // 2. Prüfen, ob Dokumente gefunden wurden
    if (documents.length === 0) {
      log('info', "Keine relevanten Dokumente gefunden");
      
      return res.json({
        reply: "In den verfügbaren Dokumenten konnte ich keine Informationen zu dieser Frage finden.",
        sources: []
      });
    }
    
    // 3. Prompt mit Token-kontrolliertem Kontext erstellen
    const userPrompt = `Frage: ${message}\nDokumentenkontext:\n${contextText}`;
    
    // 4. Schätze Token für System-Prompt + User-Prompt
    const systemTokens = estimateTokens(SYSTEM_PROMPT);
    const userTokens = estimateTokens(userPrompt);
    const totalPromptTokens = systemTokens + userTokens;
    
    log('info', `Geschätzte Token: System=${systemTokens}, User=${userTokens}, Gesamt=${totalPromptTokens}`);
    
    // Überprüfe, ob wir immer noch über dem Limit sind
    if (totalPromptTokens > AVAILABLE_CONTEXT_TOKENS) {
      log('warn', `Token-Limit überschritten (${totalPromptTokens} > ${AVAILABLE_CONTEXT_TOKENS}). Reduziere Kontextgröße.`);
      
      // Zu viele Dokumente, gebe Hinweis zurück
      return res.json({
        reply: "Ihre Anfrage betrifft zu viele oder zu umfangreiche Dokumente. Bitte stellen Sie eine spezifischere Frage, um genauere Ergebnisse zu erhalten.",
        sources: []
      });
    }
    
    // 5. API-Anfrage an Azure OpenAI mit Retry-Mechanismus
    try {
      const result = await executeWithRetry(async () => {
        log('info', 'Sende Chat-Anfrage an Azure OpenAI');
        
        const requestPayload = {
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: MAX_COMPLETION_TOKENS,
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
      
      // Token-Limit-Fehler erkennen und weitergeben
      if (apiError.message && apiError.message.includes('maximum context length')) {
        throw apiError;
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
    log('error', 'Fehler bei der Token-kontrollierten Suche:', error);
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
 * Ruft relevante Dokumente aus Azure AI Search ab mit strenger Token-Begrenzung
 */
async function retrieveRelevantDocumentsWithTokenLimit(query) {
  log('debug', `Suche nach relevanten Dokumenten für: "${query}"`);
  
  try {
    // Stark reduzierte Suchoptionen
    const searchOptions = {
      select: ["content", "title", "filepath", "filename"],
      top: 2, // Nur 2 Dokumente
      queryType: "simple"
    };
    
    try {
      const searchResults = await searchClient.search(query, searchOptions);
      
      const results = [];
      let contextText = "";
      let totalTokens = 0;
      const maxContextTokens = AVAILABLE_CONTEXT_TOKENS - estimateTokens(SYSTEM_PROMPT) - estimateTokens(`Frage: ${query}\nDokumentenkontext:\n`);
      
      // Dokumentergebnisse verarbeiten (mit stark begrenztem Inhalt)
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
          
          // Stark gekürzter Inhalt für den Kontext
          // Maximal 200 Zeichen pro Dokument
          const maxContentLength = 200;
          const trimmedContent = doc.content.length > maxContentLength 
            ? doc.content.substring(0, maxContentLength) + "..." 
            : doc.content;
          
          // Berechne Token für diesen Dokumentabschnitt
          const docEntry = `Dokument: ${doc.documentName}, S.${doc.pageNumber}: ${trimmedContent}\n\n`;
          const docTokens = estimateTokens(docEntry);
          
          // Überprüfe, ob wir das Token-Limit überschreiten würden
          if (totalTokens + docTokens > maxContextTokens) {
            log('warn', `Token-Limit erreicht. Stoppe Hinzufügen weiterer Dokumente. Aktuell: ${totalTokens}/${maxContextTokens}`);
            break;
          }
          
          // Füge Dokument hinzu und aktualisiere Token-Zähler
          contextText += docEntry;
          totalTokens += docTokens;
          results.push(doc);
          
          log('debug', `Dokument hinzugefügt. Token bisher: ${totalTokens}/${maxContextTokens}`);
        } catch (docError) {
          log('error', "Fehler beim Verarbeiten eines Dokumentergebnisses:", docError);
        }
      }
      
      log('info', `${results.length} relevante Dokumentenabschnitte gefunden (${totalTokens} Token)`);
      
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
    message: 'Token-Limit-Fix Version'
  });
});

// Test search functionality
app.get('/api/test-search', async (req, res) => {
  try {
    const query = req.query.q || 'test query';
    const { documents } = await retrieveRelevantDocumentsWithTokenLimit(query);
    
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
  console.log(`Server läuft auf Port ${PORT} (Token-Limit-Fix Version)`);
  console.log(`System-Prompt konfiguriert mit ${SYSTEM_PROMPT.length} Zeichen (minimal)`);
  console.log(`Verwendetes Azure OpenAI-Deployment: ${DEPLOYMENT_NAME}`);
  console.log(`Konfiguriertes Token-Limit: ${MAX_MODEL_TOKENS} (${AVAILABLE_CONTEXT_TOKENS} für Kontext verfügbar)`);
  console.log(`Verwendeter Azure AI Search-Index: ${process.env.AZURE_SEARCH_INDEX_NAME}`);
  console.log(`Gesundheitscheck verfügbar unter http://localhost:${PORT}/health`);
});