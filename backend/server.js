// Import required dependencies
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
require('dotenv').config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

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

// Normalize Azure OpenAI endpoint URL
const normalizeEndpoint = (endpoint) => {
  if (!endpoint.endsWith('/')) {
    return endpoint + '/';
  }
  return endpoint;
};

// Azure OpenAI Konfiguration
const azureEndpoint = normalizeEndpoint(process.env.AZURE_OPENAI_ENDPOINT);
const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
const apiKey = process.env.AZURE_OPENAI_API_KEY;

// Azure Search Konfiguration
const searchClient = new SearchClient(
  process.env.AZURE_SEARCH_ENDPOINT,
  process.env.AZURE_SEARCH_INDEX_NAME,
  new AzureKeyCredential(process.env.AZURE_SEARCH_API_KEY)
);

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

/**
 * Funktion zum Abrufen relevanter Dokumente aus Azure AI Search
 */
async function retrieveRelevantDocuments(query) {
  console.log(`Suche nach relevanten Dokumenten für: "${query}"`);
  
  try {
    // Verbesserte Suche für bessere Ergebnisse
    let searchOptions = {
      select: ["content", "document_name", "page_number", "paragraph_number"],
      top: 15, // Mehr Dokumente für besseren Kontext
      queryType: "full" // Standardmäßig full-text search
    };
    
    // Versuche zuerst semantische Suche, wenn verfügbar
    try {
      // Versuche semantische Suche, wenn konfiguriert
      if (process.env.USE_SEMANTIC_SEARCH === 'true') {
        searchOptions.queryType = "semantic";
        searchOptions.queryLanguage = "de-de";
        searchOptions.semanticConfiguration = "default";
        console.log("Versuche semantische Suche...");
      }
      
      const searchResults = await searchClient.search(query, searchOptions);
      console.log("Suche erfolgreich durchgeführt.");
      
      const results = [];
      let contextText = "";
      
      // Iteriere durch die gefundenen Dokumente
      for await (const result of searchResults.results) {
        // Extrahiere Dokumentinformationen
        if (!result.document) {
          console.warn("Warnung: Dokument ohne Inhalt gefunden");
          continue;
        }
        
        try {
          const doc = {
            content: result.document.content || "",
            documentName: result.document.document_name || "Unbekanntes Dokument",
            pageNumber: result.document.page_number || 1,
            paragraphNumber: result.document.paragraph_number || 0
          };
          
          // Füge zum Kontext hinzu
          contextText += `Dokument: ${doc.documentName}\n`;
          contextText += `Seite: ${doc.pageNumber}\n`;
          contextText += `Inhalt: ${doc.content}\n\n`;
          
          results.push(doc);
        } catch (docError) {
          console.error("Fehler beim Verarbeiten eines Dokumentergebnisses:", docError);
        }
      }
      
      console.log(`${results.length} relevante Dokumentenabschnitte gefunden.`);
      
      return { contextText, documents: results };
      
    } catch (searchError) {
      console.error("Fehler bei der Suche:", searchError);
      
      // Versuch eines Fallbacks auf eine einfachere Suchmethode bei Problemen
      console.log("Versuche einfachere Suche ohne spezielle Parameter...");
      
      // Letzte Chance: Basiskonfiguration ohne spezielle Parameter
      const basicResults = await searchClient.search(query, {
        select: ["content", "document_name", "page_number", "paragraph_number"],
        top: 10
      });
      
      const results = [];
      let contextText = "";
      
      for await (const result of basicResults.results) {
        if (!result.document) continue;
        
        const doc = {
          content: result.document.content || "",
          documentName: result.document.document_name || "Unbekanntes Dokument",
          pageNumber: result.document.page_number || 1,
          paragraphNumber: result.document.paragraph_number || 0
        };
        
        contextText += `Dokument: ${doc.documentName}\n`;
        contextText += `Seite: ${doc.pageNumber}\n`;
        contextText += `Inhalt: ${doc.content}\n\n`;
        
        results.push(doc);
      }
      
      console.log(`${results.length} relevante Dokumentenabschnitte mit einfacher Suche gefunden.`);
      
      return { contextText, documents: results };
    }
  } catch (error) {
    console.error("Kritischer Fehler beim Abrufen relevanter Dokumente:", error);
    console.error("Azure Search Client Verbindungsdaten überprüfen:");
    console.error(`- Endpoint: ${process.env.AZURE_SEARCH_ENDPOINT}`);
    console.error(`- Index Name: ${process.env.AZURE_SEARCH_INDEX_NAME}`);
    console.error(`- API Key: ${process.env.AZURE_SEARCH_API_KEY ? '(Set)' : '(Not Set)'}`);
    
    // Rückgabe leerer Ergebnisse im Fehlerfall
    return { contextText: "", documents: [] };
  }
}

// API endpoint to handle chat requests
app.post('/api/chat', async (req, res) => {
  try {
    // Validate request body
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log(`Neue Benutzeranfrage: "${message}"`);
    
    try {
      // 1. Abrufen relevanter Dokumente aus dem Search Index
      const { contextText, documents } = await retrieveRelevantDocuments(message);
      
      // 2. Überprüfen, ob relevante Dokumente gefunden wurden
      if (documents.length === 0) {
        console.log("Keine relevanten Dokumente gefunden.");
        
        // Noch einen Versuch mit einer einfacheren Suche
        const simpleQuery = message.split(' ').slice(0, 3).join(' '); // Ersten 3 Wörter
        console.log(`Versuche einfachere Suche mit: "${simpleQuery}"`);
        
        const simpleSearch = await retrieveRelevantDocuments(simpleQuery);
        
        if (simpleSearch.documents.length === 0) {
          return res.json({
            reply: "In den verfügbaren Dokumenten konnte ich keine Informationen zu dieser Frage finden.",
            sources: []
          });
        } else {
          // Fahre mit den einfacher gefundenen Dokumenten fort
          console.log(`Alternative Suche fand ${simpleSearch.documents.length} Dokumente.`);
          contextText = simpleSearch.contextText;
          documents = simpleSearch.documents;
        }
      }
      
      // 3. Erstellen des erweiterten Prompts mit Kontext aus den Dokumenten
      const userPrompt = `Beantworte folgende Frage basierend auf den gegebenen Dokumentausschnitten. Verwende NUR Informationen aus diesen Ausschnitten und gib für jede Information die Quelle mit Dokumentnamen und Seitenzahl an.

Frage: ${message}

Hier sind die relevanten Dokumentausschnitte:

${contextText}`;

      // 4. Configure request to Azure OpenAI API
      const apiUrl = `${azureEndpoint}openai/deployments/${deploymentName}/chat/completions?api-version=2023-05-15`;
      
      console.log(`OpenAI API Anfrage an: ${apiUrl}`);
      console.log(`Verwendetes Deployment: ${deploymentName}`);
      
      const requestPayload = {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 800,
        temperature: 0.1, // Very low temperature for more deterministic responses
        top_p: 0.95,      // High top_p for more focused responses
        frequency_penalty: 0.0,
        presence_penalty: 0.0
      };
      
      console.log('Sende Anfrage an Azure OpenAI...');
      
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

      console.log('Antwort von Azure OpenAI erhalten');
      
      // Ensure we got a valid response
      if (!response.data || !response.data.choices || response.data.choices.length === 0) {
        console.error('Ungültiges Antwortformat:', response.data);
        return res.status(500).json({ 
          error: 'Ungültige Antwort von Azure OpenAI API', 
          details: 'Die Antwort enthielt keine erwarteten Daten' 
        });
      }

      // Extract the bot's reply
      const botReply = response.data.choices[0].message.content;
      console.log(`Bot-Antwort: "${botReply.substring(0, 100)}..."`);
      
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
      
      console.log(`${sources.length} eindeutige Quellen extrahiert`);
      
      // Check if we need to enforce the citation requirement
      if (sources.length === 0 && botReply.length > 50 && !botReply.includes("keine Informationen zu dieser Frage finden")) {
        console.warn("Antwort enthält keine Quellenangaben, fordere Korrektur an");
        
        // Make a follow-up request to correct the issue
        const correctionPayload = {
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
            { role: 'assistant', content: botReply },
            { role: 'user', content: 'Deine Antwort enthält keine Quellenangaben. Bitte wiederhole die gleiche Antwort, aber füge bei jeder Information die Quelle mit Seitenzahl im Format (Quelle: Dokumentname, Seite X) hinzu.' }
          ],
          max_tokens: 800,
          temperature: 0.0 // Zero temperature for maximum determinism
        };
        
        console.log('Sende Korrekturanfrage für fehlende Quellenangaben...');
        
        try {
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
          console.log(`Korrigierte Antwort: "${correctedReply.substring(0, 100)}..."`);
          
          // Re-extract sources
          const correctedSources = [];
          let sourceMatch;
          const correctedSourceRegex = /\(Quelle: ([^,]+), Seite (\d+)\)/g;
          
          while ((sourceMatch = correctedSourceRegex.exec(correctedReply)) !== null) {
            const document = sourceMatch[1].trim();
            const page = parseInt(sourceMatch[2]);
            
            if (!correctedSources.some(s => s.document === document && s.page === page)) {
              correctedSources.push({ document, page });
            }
          }
          
          return res.json({ 
            reply: correctedReply,
            sources: correctedSources
          });
        } catch (correctionError) {
          console.error('Fehler bei der Korrekturanfrage:', correctionError);
          console.log('Sende ursprüngliche Antwort ohne Korrektur.');
          
          // Fallback zur originalen Antwort bei Fehler
          return res.json({ 
            reply: botReply,
            sources: sources
          });
        }
      }
      
      return res.json({ 
        reply: botReply,
        sources: sources
      });
    } catch (innerError) {
      console.error('Innerer Fehler bei der Verarbeitung:', innerError);
      throw innerError; // Weitergabe an äußere Fehlerbehandlung
    }
    
  } catch (error) {
    console.error('Fehler bei der Kommunikation mit der Azure OpenAI API:', error.message);
    
    // Provide more detailed error information for debugging
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    } else if (error.request) {
      console.error('Keine Antwort erhalten, Anfrage war:', error.request);
    } else {
      console.error('Fehler beim Einrichten der Anfrage:', error.message);
    }
    
    return res.status(500).json({ 
      error: 'Fehler bei der Antwort von Azure OpenAI API',
      details: error.message
    });
  }
});

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
    semanticSearchEnabled: process.env.USE_SEMANTIC_SEARCH === 'true'
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
  console.log(`System-Prompt konfiguriert mit ${SYSTEM_PROMPT.length} Zeichen`);
  console.log(`Verwendetes Azure OpenAI-Deployment: ${deploymentName}`);
  console.log(`Verwendeter Azure AI Search-Index: ${process.env.AZURE_SEARCH_INDEX_NAME}`);
  console.log(`Gesundheitscheck verfügbar unter http://localhost:${PORT}/health`);
  console.log(`Suchtest verfügbar unter http://localhost:${PORT}/api/test-search?q=ihre+suchanfrage`);
  console.log(`Such-Konfigurations-Debug verfügbar unter http://localhost:${PORT}/api/debug/search-config`);
});