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

// Modified system prompt to allow general knowledge fallback
const SYSTEM_PROMPT = `Du bist ein präziser Recherche-Assistent, der NUR auf Deutsch antwortet.

PRIORITÄT 1: Wenn Informationen in den bereitgestellten Dokumenten verfügbar sind:
- Verwende AUSSCHLIESSLICH diese dokumentierten Informationen
- Bei JEDER Information aus den Dokumenten MUSST du die genaue Quelle in Klammern direkt dahinter angeben
- Format für Dokumentquellen: (Quelle: Dokumentname, Seite X)

PRIORITÄT 2: Wenn keine relevanten Informationen in den Dokumenten zu finden sind:
- Gib klar an: "In den verfügbaren Dokumenten konnte ich keine spezifischen Informationen zu dieser Frage finden."
- Danach kannst du eine allgemeine Antwort basierend auf deinem eigenen Wissen geben, aber kennzeichne diese klar mit: "[Allgemeinwissen]"

Formatierungsanweisungen:
1. Gliedere deine Antwort in klare Absätze
2. Stelle die wichtigsten Informationen an den Anfang
3. Nenne bei JEDER Information aus Dokumenten die Quelle als (Quelle: Dokumentname, Seite X)
4. Trenne dokumentierte Informationen klar von allgemeinem Wissen`;

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
      // Check which approach to use
      const useDataFeature = process.env.USE_AZURE_OPENAI_DATA_FEATURE === 'true';
      
      if (useDataFeature) {
        log('info', 'Verwende native Azure OpenAI "Your Data"-Funktion mit direktem API-Aufruf');
        await handleChatWithDataFeature(message, res);
      } else {
        log('info', 'Verwende manuelle Suche und Kontext-Erstellung');
        await handleChatWithManualSearch(message, res);
      }
    } catch (innerError) {
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
 * Verarbeitet Chat-Anfragen mit der nativen Azure OpenAI "Your Data"-Funktion
 * mit direktem API-Aufruf
 */
async function handleChatWithDataFeature(message, res) {
  try {
    log('debug', 'Starte Chat mit nativer "Your Data"-Funktion über direkten API-Aufruf');
    
    // Datenquelle mit korrekten camelCase-Namen für die direkten API-Aufrufe
    const dataSource = {
      type: "azure_search",
      parameters: {
        endpoint: process.env.AZURE_SEARCH_ENDPOINT,
        key: process.env.AZURE_SEARCH_API_KEY,
        indexName: process.env.AZURE_SEARCH_INDEX_NAME,
        roleInformation: SYSTEM_PROMPT,
        fieldsMapping: {
          contentFields: ["content"],
          titleField: "title", 
          urlField: "url",
          filepathField: "filepath",
          vectorFields: []
        }
      }
    };
    
    // Anfrage-Nachrichten
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: message }
    ];
    
    // Direkter API-Aufruf statt SDK
    log('info', 'Sende Anfrage an Azure OpenAI mit Datenquelle via direktem API-Aufruf');
    const result = await sendDirectApiRequest(
      process.env.AZURE_OPENAI_ENDPOINT,
      process.env.AZURE_OPENAI_API_KEY,
      DEPLOYMENT_NAME,
      messages,
      [dataSource]
    );
    
    // Antwort verarbeiten
    if (!result || !result.choices || result.choices.length === 0) {
      log('error', 'Ungültige Antwort von Azure OpenAI API:', result);
      return res.status(500).json({
        error: 'Ungültige Antwort von Azure OpenAI API',
        details: 'Die Antwort enthielt keine erwarteten Daten'
      });
    }

    // Antwort extrahieren
    const botReply = result.choices[0].message.content;
    log('info', `Bot-Antwort: "${botReply.substring(0, 100)}..."`);

    // Quellen aus der Antwort extrahieren
    const sources = extractSourcesFromText(botReply);
    log('info', `${sources.length} eindeutige Quellen extrahiert`);

    // Antwort senden
    return res.json({
      reply: botReply,
      sources: sources
    });
  } catch (error) {
    log('error', 'Fehler bei der Verwendung der "Your Data"-Funktion:', error);
    throw error;
  }
}

/**
 * Fallback-Methode: Verarbeitet Chat-Anfragen mit manueller Suche und Kontext-Erstellung
 */
async function handleChatWithManualSearch(message, res) {
  try {
    log('debug', 'Starte Chat mit manueller Suche');
    
    // 1. Relevante Dokumente aus dem Suchindex abrufen
    const { contextText, documents } = await retrieveRelevantDocuments(message);
    
    // 2. Prüfen, ob Dokumente gefunden wurden
    let userPrompt;
    
    if (documents.length === 0) {
      log('info', "Keine relevanten Dokumente gefunden");
      
      // Einen Versuch mit einer einfacheren Suche
      const simpleQuery = message.split(' ').slice(0, 3).join(' '); // Ersten 3 Wörter
      log('debug', `Versuche einfachere Suche mit: "${simpleQuery}"`);
      
      const simpleSearch = await retrieveRelevantDocuments(simpleQuery);
      
      if (simpleSearch.documents.length === 0) {
        // ÄNDERUNG: Statt nur "keine Informationen" zurückzugeben, 
        // erlauben wir dem Modell, auf sein allgemeines Wissen zurückzugreifen
        userPrompt = `
Zu folgender Frage wurden keine relevanten Informationen in den Dokumenten gefunden: "${message}"

Bitte antworte wie folgt:
1. Erwähne zuerst, dass keine spezifischen Informationen in den Dokumenten gefunden wurden
2. Gib dann eine allgemeine Antwort basierend auf deinem Wissen, deutlich mit "[Allgemeinwissen]:" gekennzeichnet`;
      } else {
        // Mit den gefundenen Dokumenten fortfahren
        log('info', `Alternative Suche fand ${simpleSearch.documents.length} Dokumente`);
        contextText = simpleSearch.contextText;
        documents = simpleSearch.documents;
        
        userPrompt = `Beantworte folgende Frage basierend auf den gegebenen Dokumentausschnitten. Verwende NUR Informationen aus diesen Ausschnitten und gib für jede Information die Quelle mit Dokumentnamen und Seitenzahl an.

Frage: ${message}

Hier sind die relevanten Dokumentausschnitte:

${contextText}`;
      }
    } else {
      // Normal mit gefundenen Dokumenten fortfahren
      userPrompt = `Beantworte folgende Frage basierend auf den gegebenen Dokumentausschnitten. Verwende NUR Informationen aus diesen Ausschnitten und gib für jede Information die Quelle mit Dokumentnamen und Seitenzahl an.

Frage: ${message}

Hier sind die relevanten Dokumentausschnitte:

${contextText}`;
    }

    // 4. API-Anfrage an Azure OpenAI
    const requestPayload = {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 800,
      temperature: 0.1,
      top_p: 0.95,
      frequency_penalty: 0.0,
      presence_penalty: 0.0
    };
    
    log('info', 'Sende direkte Chat-Anfrage an Azure OpenAI');
    
    const result = await client.getChatCompletions(
      DEPLOYMENT_NAME,
      requestPayload.messages,
      {
        maxTokens: requestPayload.max_tokens,
        temperature: requestPayload.temperature,
        topP: requestPayload.top_p,
        frequencyPenalty: requestPayload.frequency_penalty,
        presencePenalty: requestPayload.presence_penalty
      }
    );

    // Antwort verarbeiten
    const botReply = result.choices[0].message.content;
    log('info', `Bot-Antwort: "${botReply.substring(0, 100)}..."`);
    
    // Quellen extrahieren
    const sources = extractSourcesFromText(botReply);
    log('info', `${sources.length} eindeutige Quellen extrahiert`);
    
    // Antwort senden
    return res.json({
      reply: botReply,
      sources: sources
    });
    
  } catch (error) {
    log('error', 'Fehler bei der manuellen Suche und Kontexterstellung:', error);
    throw error;
  }
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
 * Ruft relevante Dokumente aus dem Azure AI Search-Index ab
 * Mit Token-Limit-Kontrolle
 */
async function retrieveRelevantDocuments(query) {
  log('debug', `Suche nach relevanten Dokumenten für: "${query}"`);
  
  try {
    // Suchoptionen konfigurieren
    let searchOptions = {
      select: ["content", "title", "filepath", "filename"],
      top: 10, // Reduziert von 15 auf 10
      queryType: "full"
    };
    
    // Semantische Suche verwenden, falls aktiviert
    if (process.env.USE_SEMANTIC_SEARCH === 'true') {
      searchOptions.queryType = "semantic";
      searchOptions.queryLanguage = "de-de";
      searchOptions.semanticConfiguration = "my-semantic-config";
      log('debug', "Verwende semantische Suche");
    }
    
    // Suche ausführen
    try {
      const searchResults = await searchClient.search(query, searchOptions);
      
      const results = [];
      let contextText = "";
      let totalTokenCount = 0;
      const MAX_TOKEN_ESTIMATE = 10000; // Sicherer Grenzwert
      
      // Dokumentergebnisse verarbeiten mit Token-Limit
      for await (const result of searchResults.results) {
        if (!result.document) {
          log('warn', "Warnung: Dokument ohne Inhalt gefunden");
          continue;
        }
        
        try {
          // Feldnamen anpassen (passend zum Index)
          const doc = {
            content: result.document.content || "",
            documentName: result.document.filename || result.document.title || "Unbekanntes Dokument",
            pageNumber: result.document.filepath ? parseInt(result.document.filepath) || 1 : 1,
          };
          
          // Tokengröße schätzen - ungefähr 4 Zeichen pro Token als grobe Schätzung
          const estimatedTokens = Math.ceil(doc.content.length / 4);
          
          // Wenn das Token-Limit überschritten wird, nicht mehr hinzufügen
          if (totalTokenCount + estimatedTokens > MAX_TOKEN_ESTIMATE) {
            log('warn', `Token-Limit erreicht, überspringe restliche Dokumente`);
            break;
          }
          
          // Gegebenenfalls Inhalt kürzen, wenn einzelnes Dokument zu groß ist
          if (estimatedTokens > 2000) { // Grenze für ein einzelnes Dokument
            const charLimit = 2000 * 4; // ca. 8000 Zeichen
            doc.content = doc.content.substring(0, charLimit) + "... [Dokument gekürzt wegen Größe]";
            log('warn', `Großes Dokument gekürzt: ${doc.documentName}`);
          }
          
          // Kontext für die Anfrage aufbauen
          contextText += `Dokument: ${doc.documentName}\n`;
          contextText += `Seite: ${doc.pageNumber}\n`;
          contextText += `Inhalt: ${doc.content}\n\n`;
          
          totalTokenCount += estimatedTokens;
          results.push(doc);
        } catch (docError) {
          log('error', "Fehler beim Verarbeiten eines Dokumentergebnisses:", docError);
        }
      }
      
      log('info', `${results.length} relevante Dokumentenabschnitte gefunden`);
      log('debug', `Geschätzte Token-Anzahl: ${totalTokenCount}`);
      
      return { contextText, documents: results };
      
    } catch (searchError) {
      log('error', "Fehler bei der Suche:", searchError);
      
      // Fallback auf einfachere Suche mit reduzierten Ergebnissen
      log('warn', "Versuche einfachere Suche mit reduzierten Parametern");
      
      const basicResults = await searchClient.search(query, {
        select: ["*"],
        top: 5 // Reduziert von 10 auf 5
      });
      
      const results = [];
      let contextText = "";
      let totalTokenCount = 0;
      const MAX_TOKEN_ESTIMATE = 10000;
      
      for await (const result of basicResults.results) {
        if (!result.document) continue;
        
        // Versuch, die Felder dynamisch zu identifizieren
        const docFields = Object.keys(result.document);
        log('debug', `Verfügbare Felder: ${docFields.join(', ')}`);
        
        // Inhaltsfeld identifizieren (content oder text)
        const contentField = docFields.find(f => f === 'content' || f === 'text' || f.includes('content') || f.includes('text'));
        // Titel identifizieren (document_name, title, name)
        const titleField = docFields.find(f => f === 'document_name' || f === 'title' || f === 'filename' || f.includes('name') || f.includes('title'));
        // Seitennummer identifizieren (page_number, page)
        const pageField = docFields.find(f => f === 'page_number' || f === 'page' || f === 'filepath' || f.includes('page'));
        
        const content = contentField ? result.document[contentField] : "Kein Inhalt";
        
        // Tokengröße schätzen
        const estimatedTokens = Math.ceil(content.length / 4);
        
        // Wenn das Token-Limit überschritten wird, nicht mehr hinzufügen
        if (totalTokenCount + estimatedTokens > MAX_TOKEN_ESTIMATE) {
          log('warn', `Token-Limit erreicht, überspringe restliche Dokumente`);
          break;
        }
        
        // Dokument gegebenenfalls kürzen
        let processedContent = content;
        if (estimatedTokens > 2000) { // Grenze für ein einzelnes Dokument
          const charLimit = 2000 * 4; // ca. 8000 Zeichen
          processedContent = content.substring(0, charLimit) + "... [Dokument gekürzt wegen Größe]";
          log('warn', `Großes Dokument gekürzt: ${result.document[titleField] || "Unbekannt"}`);
        }
        
        const doc = {
          content: processedContent,
          documentName: titleField ? result.document[titleField] : "Unbekanntes Dokument",
          pageNumber: pageField ? parseInt(result.document[pageField]) || 1 : 1
        };
        
        contextText += `Dokument: ${doc.documentName}\n`;
        contextText += `Seite: ${doc.pageNumber}\n`;
        contextText += `Inhalt: ${doc.content}\n\n`;
        
        totalTokenCount += estimatedTokens;
        results.push(doc);
      }
      
      log('info', `${results.length} relevante Dokumentenabschnitte mit einfacher Suche gefunden`);
      log('debug', `Geschätzte Token-Anzahl: ${totalTokenCount}`);
      
      return { contextText, documents: results };
    }
  } catch (error) {
    log('error', "Kritischer Fehler beim Abrufen relevanter Dokumente:", error);
    log('error', "Azure Search Client Verbindungsdaten überprüfen:");
    log('error', `- Endpoint: ${process.env.AZURE_SEARCH_ENDPOINT}`);
    log('error', `- Index Name: ${process.env.AZURE_SEARCH_INDEX_NAME}`);
    log('error', `- API Key: ${process.env.AZURE_SEARCH_API_KEY ? '(Set)' : '(Not Set)'}`);
    
    // Leere Ergebnisse im Fehlerfall zurückgeben
    return { contextText: "", documents: [] };
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
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
        preview: d.content.substring(0, 200) + '...'
      }))
    });
  } catch (error) {
    console.error('Error testing search:', error);
    return res.status(500).json({ error: 'Error testing search', details: error.message });
  }
});

// Debug endpoint for Azure Search configuration
app.get('/api/debug/search-config', (req, res) => {
  // Sicherheitshinweis: API-Schlüssel nicht vollständig anzeigen
  const maskedKey = process.env.AZURE_SEARCH_API_KEY 
    ? `${process.env.AZURE_SEARCH_API_KEY.substring(0, 4)}...${process.env.AZURE_SEARCH_API_KEY.substring(process.env.AZURE_SEARCH_API_KEY.length - 4)}`
    : 'Not Set';
  
  return res.json({
    endpoint: process.env.AZURE_SEARCH_ENDPOINT,
    indexName: process.env.AZURE_SEARCH_INDEX_NAME,
    keyPresent: !!process.env.AZURE_SEARCH_API_KEY,
    keyPreview: maskedKey,
    semanticSearchEnabled: process.env.USE_SEMANTIC_SEARCH === 'true',
    useDataFeature: process.env.USE_AZURE_OPENAI_DATA_FEATURE === 'true'
  });
});

// Advanced debug endpoint - checks connection and index schema
app.get('/api/debug/index-structure', async (req, res) => {
  try {
    // Einfache Suche, um ein Dokument zu erhalten
    log('debug', 'Prüfe Index-Struktur mit Beispielanfrage');
    const searchResults = await searchClient.search("*", { top: 1 });
    
    let sampleDoc = null;
    let fieldNames = [];
    let totalDocs = 0;
    
    for await (const result of searchResults.results) {
      totalDocs++;
      if (!sampleDoc && result.document) {
        sampleDoc = result.document;
        fieldNames = Object.keys(result.document);
      }
    }
    
    // Dynamische Felder identifizieren
    const identifiedFields = {
      contentField: fieldNames.find(f => f === 'content' || f === 'text' || f.includes('content') || f.includes('text')),
      titleField: fieldNames.find(f => f === 'document_name' || f === 'title' || f === 'filename' || f.includes('name') || f.includes('title')),
      pageField: fieldNames.find(f => f === 'page_number' || f === 'page' || f === 'filepath' || f.includes('page'))
    };
    
    return res.json({
      indexName: process.env.AZURE_SEARCH_INDEX_NAME,
      documentsFound: totalDocs,
      fieldNames: fieldNames,
      identifiedFields: identifiedFields,
      sampleDocument: sampleDoc,
      isConnected: true
    });
  } catch (error) {
    log('error', 'Fehler beim Prüfen der Index-Struktur:', error);
    return res.status(500).json({ 
      error: 'Fehler beim Prüfen der Index-Struktur', 
      details: error.message,
      isConnected: false
    });
  }
});

// Index field mapping config endpoint
app.post('/api/config/field-mapping', (req, res) => {
  try {
    const { contentField, titleField, pageField } = req.body;
    
    if (!contentField) {
      return res.status(400).json({ error: 'contentField ist erforderlich' });
    }
    
    // Speichern Sie die Konfiguration in Umgebungsvariablen
    process.env.FIELD_MAPPING_CONTENT = contentField;
    process.env.FIELD_MAPPING_TITLE = titleField || 'title';
    process.env.FIELD_MAPPING_PAGE = pageField || 'filepath';
    
    log('info', `Feldmappings aktualisiert: content=${contentField}, title=${titleField}, page=${pageField}`);
    
    return res.json({ 
      success: true, 
      message: 'Feldmappings erfolgreich aktualisiert',
      mapping: {
        contentField: process.env.FIELD_MAPPING_CONTENT,
        titleField: process.env.FIELD_MAPPING_TITLE,
        pageField: process.env.FIELD_MAPPING_PAGE
      }
    });
  } catch (error) {
    log('error', 'Fehler beim Aktualisieren der Feldmappings:', error);
    return res.status(500).json({ error: 'Fehler beim Aktualisieren der Feldmappings' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
  console.log(`System-Prompt konfiguriert mit ${SYSTEM_PROMPT.length} Zeichen`);
  console.log(`Verwendetes Azure OpenAI-Deployment: ${DEPLOYMENT_NAME}`);
  console.log(`Verwendeter Azure AI Search-Index: ${process.env.AZURE_SEARCH_INDEX_NAME}`);
  console.log(`Gesundheitscheck verfügbar unter http://localhost:${PORT}/health`);
  console.log(`Suchtest verfügbar unter http://localhost:${PORT}/api/test-search?q=ihre+suchanfrage`);
  console.log(`Such-Konfigurations-Debug verfügbar unter http://localhost:${PORT}/api/debug/search-config`);
  console.log(`Index-Struktur-Debug verfügbar unter http://localhost:${PORT}/api/debug/index-structure`);
});