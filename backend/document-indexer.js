// Dokument-Indexierer für Azure AI Chat Application
// Dieses Skript indexiert Dokumente (PDF, DOCX, TXT) in Azure AI Search

const { BlobServiceClient } = require('@azure/storage-blob');
const { SearchIndexClient, SearchClient, AzureKeyCredential } = require('@azure/search-documents');
const { readFile, readdir, stat, mkdir } = require('fs/promises');
const { join, extname, basename, dirname } = require('path');
const path = require('path');
const pdfjsLib = require('pdfjs-dist');
const mammoth = require('mammoth');
const dotenv = require('dotenv');
const fs = require('fs').promises;

// Lade Umgebungsvariablen
dotenv.config();

// Konfiguration
const config = {
  // Azure Storage für Dokumente
  storageConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
  storageContainerName: process.env.AZURE_STORAGE_CONTAINER_NAME || 'documents',
  
  // Azure AI Search
  searchEndpoint: process.env.AZURE_SEARCH_ENDPOINT,
  searchApiKey: process.env.AZURE_SEARCH_API_KEY,
  searchIndexName: process.env.AZURE_SEARCH_INDEX_NAME || 'knowledge-index',
  
  // Verarbeitungsoptionen
  chunkSize: 1000,             // Zeichen pro Chunk
  chunkOverlap: 200,           // Überlappung zwischen Chunks zur Kontexterhaltung
  documentsDir: './documents', // Lokales Verzeichnis mit zu indizierenden Dokumenten
  uploadToBlob: true,          // Dokumente zu Azure Blob Storage hochladen?
};

// Prüfung der benötigten Umgebungsvariablen
const requiredEnvVars = [
  'AZURE_SEARCH_ENDPOINT',
  'AZURE_SEARCH_API_KEY'
];

// Füge weitere erforderliche Variablen hinzu, wenn Blob Storage aktiviert ist
if (config.uploadToBlob) {
  requiredEnvVars.push('AZURE_STORAGE_CONNECTION_STRING');
}

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Fehler: Umgebungsvariable ${envVar} ist nicht gesetzt.`);
    process.exit(1);
  }
}

/**
 * Hauptfunktion zur Dokumentenindexierung
 */
async function indexDocuments() {
  console.log('Starte Dokumentindexierung...');
  
  try {
    // 1. Initialisiere Azure AI Search Client
    const searchIndexClient = new SearchIndexClient(
      config.searchEndpoint,
      new AzureKeyCredential(config.searchApiKey)
    );
    
    const searchClient = new SearchClient(
      config.searchEndpoint,
      config.searchIndexName,
      new AzureKeyCredential(config.searchApiKey)
    );
    
    // 2. Initialisiere Azure Blob Storage Client (falls aktiviert)
    let containerClient = null;
    if (config.uploadToBlob) {
      const blobServiceClient = BlobServiceClient.fromConnectionString(config.storageConnectionString);
      containerClient = blobServiceClient.getContainerClient(config.storageContainerName);
      
      // Container erstellen, falls nicht vorhanden
      console.log(`Stelle sicher, dass der Container "${config.storageContainerName}" existiert...`);
      await containerClient.createIfNotExists({ access: 'blob' });
    }
    
    // 3. Such-Index erstellen/aktualisieren
    console.log(`Erstelle/Aktualisiere Such-Index "${config.searchIndexName}"...`);
    await createSearchIndex(searchIndexClient);
    
    // 4. Stelle sicher, dass das Dokumentenverzeichnis existiert
    try {
      await stat(config.documentsDir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`Erstelle Verzeichnis ${config.documentsDir}...`);
        await mkdir(config.documentsDir, { recursive: true });
      } else {
        throw error;
      }
    }
    
    // 5. Dokumente aus dem lokalen Verzeichnis lesen
    console.log(`Lese Dokumente aus "${config.documentsDir}"...`);
    const files = await readdir(config.documentsDir);
    
    if (files.length === 0) {
      console.log(`Keine Dokumente zum Indizieren gefunden. Bitte legen Sie Dateien im Verzeichnis "${config.documentsDir}" ab.`);
      return;
    }
    
    console.log(`Gefunden: ${files.length} Dateien`);
    
    // 6. Jedes Dokument verarbeiten
    for (const file of files) {
      const filePath = join(config.documentsDir, file);
      
      // Prüfen, ob es sich um eine Datei handelt (keine Verzeichnisse)
      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) continue;
      
      const fileExtension = extname(file).toLowerCase();
      
      console.log(`\nVerarbeite Datei: ${file}`);
      
      try {
        // 6a. Dokument zu Azure Storage hochladen (falls aktiviert)
        let blobUrl = null;
        if (config.uploadToBlob && containerClient) {
          const blobName = file.replace(/\s+/g, '_');
          const blockBlobClient = containerClient.getBlockBlobClient(blobName);
          const fileData = await readFile(filePath);
          await blockBlobClient.upload(fileData, fileData.length);
          blobUrl = blockBlobClient.url;
          
          console.log(`  Hochgeladen nach: ${blobUrl}`);
        }
        
        // 6b. Textinhalt extrahieren
        let textContent;
        let pageCount = 1;
        let pageTexts = [];
        
        if (fileExtension === '.pdf') {
          ({ textContent, pageCount, pageTexts } = await extractTextFromPdf(filePath));
        } else if (fileExtension === '.docx') {
          textContent = await extractTextFromDocx(filePath);
          // Bei DOCX können wir keine Seitenzahlen extrahieren, daher schätzen wir
          pageCount = Math.ceil(textContent.length / 3000); // Grobe Schätzung: ~3000 Zeichen pro Seite
        } else if (['.txt', '.md', '.html'].includes(fileExtension)) {
          textContent = (await readFile(filePath, 'utf-8')).toString();
          // Bei TXT können wir keine Seitenzahlen extrahieren, daher schätzen wir
          pageCount = Math.ceil(textContent.length / 3000); // Grobe Schätzung: ~3000 Zeichen pro Seite
        } else {
          console.warn(`  Überspringe nicht unterstütztes Dateiformat: ${fileExtension}`);
          continue;
        }
        
        // 6c. Text in Chunks aufteilen
        const documentName = basename(file);
        let chunks = [];
        
        if (pageTexts && pageTexts.length > 0) {
          // Wenn wir Seiteninformationen haben (z.B. von PDF)
          for (const pageInfo of pageTexts) {
            const pageChunks = chunkText(pageInfo.text, pageInfo.page, pageInfo.page);
            chunks = chunks.concat(pageChunks);
          }
        } else {
          // Ohne Seiteninformationen
          chunks = chunkText(textContent, 1, pageCount);
        }
        
        console.log(`  Teile Dokument in ${chunks.length} Chunks auf...`);
        
        // 6d. Chunks indexieren
        const indexDocuments = chunks.map((chunk, index) => ({
          id: `${documentName.replace(/\s+/g, '_').replace(/\.[^/.]+$/, '')}_chunk_${index}`,
          content: chunk.text,
          document_name: documentName,
          document_url: blobUrl || '',
          page_number: chunk.page,
          paragraph_number: index + 1,
          chunk_number: index,
        }));
        
        console.log(`  Indexiere ${indexDocuments.length} Chunks...`);
        await indexBatch(searchClient, indexDocuments);
        
        console.log(`  ✅ ${file} erfolgreich indexiert.`);
      } catch (error) {
        console.error(`  ❌ Fehler bei der Verarbeitung von ${file}:`, error);
      }
    }
    
    console.log('\nIndexierung abgeschlossen!');
    
  } catch (error) {
    console.error('Fehler bei der Indexierung:', error);
    process.exit(1);
  }
}

/**
 * Erstellt oder aktualisiert den Azure AI Search Index
 */
async function createSearchIndex(indexClient) {
  // Definition des Suchindex
  const indexDefinition = {
    name: config.searchIndexName,
    fields: [
      { name: "id", type: "Edm.String", key: true, searchable: false },
      { name: "content", type: "Edm.String", searchable: true, filterable: false, sortable: false, facetable: false },
      { name: "document_name", type: "Edm.String", searchable: true, filterable: true, sortable: true, facetable: true },
      { name: "document_url", type: "Edm.String", searchable: false, filterable: false, sortable: false, facetable: false },
      { name: "page_number", type: "Edm.Int32", searchable: false, filterable: true, sortable: true, facetable: true },
      { name: "paragraph_number", type: "Edm.Int32", searchable: false, filterable: true, sortable: true, facetable: false },
      { name: "chunk_number", type: "Edm.Int32", searchable: false, filterable: true, sortable: true, facetable: false }
    ],
    semanticSearch: {
      configurations: [
        {
          name: "default",
          prioritizedFields: {
            titleField: { fieldName: "document_name" },
            contentFields: [{ fieldName: "content" }],
            keywordsFields: []
          }
        }
      ]
    }
  };

  try {
    // Versuche zuerst den Index mit semantischer Suche zu erstellen
    console.log("Versuche Index mit semantischer Suche zu erstellen...");
    await indexClient.createOrUpdateIndex(indexDefinition);
    console.log('  Index erfolgreich erstellt/aktualisiert mit semantischer Suche.');
  } catch (error) {
    console.warn('  Warnung:', error.message);
    
    // Wenn die semantische Suche nicht unterstützt wird, erstelle einen einfacheren Index
    if (error.message.includes('semantic') || error.statusCode === 400) {
      console.warn('  Semantische Suche wird nicht unterstützt oder falsch konfiguriert.');
      console.warn('  Erstelle vereinfachten Index ohne semantische Suche...');
      
      // Entferne die semantische Suchkonfiguration
      delete indexDefinition.semanticSearch;
      
      try {
        await indexClient.createOrUpdateIndex(indexDefinition);
        console.log('  Vereinfachter Index erfolgreich erstellt/aktualisiert.');
      } catch (simpleError) {
        console.error('  Fehler beim Erstellen des vereinfachten Index:', simpleError);
        throw simpleError;
      }
    } else {
      console.error('  Fehler beim Erstellen des Index:', error);
      throw error;
    }
  }
}

/**
 * Extrahiert Text aus einer PDF-Datei mit Seitenangaben
 */
async function extractTextFromPdf(filePath) {
  try {
    // PDF als ArrayBuffer einlesen
    const fileData = await readFile(filePath);
    const data = new Uint8Array(fileData);
    
    // PDF mit pdf.js laden
    pdfjsLib.GlobalWorkerOptions.workerSrc = '//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;
    
    const numPages = pdf.numPages;
    console.log(`  PDF hat ${numPages} Seiten`);
    
    let allText = '';
    const pageTexts = [];
    
    // Text von jeder Seite extrahieren
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      
      // Text aus den verschiedenen Elementen zusammenfügen
      const pageText = textContent.items
        .map(item => item.str)
        .join(' ')
        .replace(/\\s+/g, ' ');
      
      pageTexts.push({ page: i, text: pageText });
      allText += `[Seite ${i}]\n${pageText}\n\n`;
    }
    
    return { textContent: allText, pageCount: numPages, pageTexts };
  } catch (error) {
    console.error('  Fehler beim Extrahieren des PDF-Textes:', error);
    throw error;
  }
}

/**
 * Extrahiert Text aus einer DOCX-Datei
 */
async function extractTextFromDocx(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch (error) {
    console.error('  Fehler beim Extrahieren des DOCX-Textes:', error);
    throw error;
  }
}

/**
 * Teilt den extrahierten Text in Chunks auf und behält Seitenreferenzen bei
 */
function chunkText(text, startPage, totalPages) {
  const chunks = [];
  
  // Bei Text mit Seitenmarkierungen (vom PDF-Extraktor generiert)
  if (text.includes('[Seite ')) {
    const pageRegex = /\\[Seite (\\d+)\\](([\\s\\S]*?)(?=\\[Seite \\d+\\]|$))/g;
    let match;
    
    while ((match = pageRegex.exec(text)) !== null) {
      const pageNumber = parseInt(match[1]);
      const pageText = match[2].trim();
      
      // Seite in Chunks aufteilen, wenn sie zu lang ist
      if (pageText.length > config.chunkSize) {
        let startPos = 0;
        
        while (startPos < pageText.length) {
          const endPos = Math.min(startPos + config.chunkSize, pageText.length);
          const chunk = pageText.substring(startPos, endPos);
          
          chunks.push({ 
            text: chunk, 
            page: pageNumber 
          });
          
          startPos = endPos - config.chunkOverlap;
          if (startPos >= pageText.length) break;
        }
      } else {
        // Ganze Seite als ein Chunk
        chunks.push({ 
          text: pageText, 
          page: pageNumber 
        });
      }
    }
  } else {
    // Bei Dokumenten ohne Seitenmarkierungen
    let startPos = 0;
    
    while (startPos < text.length) {
      const endPos = Math.min(startPos + config.chunkSize, text.length);
      const chunk = text.substring(startPos, endPos);
      
      // Schätze Seitenzahl basierend auf Position im Dokument
      // Für Dokumente ohne erkannte Seitenumbrüche
      const progress = startPos / text.length;
      const estimatedPage = startPage + Math.floor(progress * (totalPages - startPage));
      
      chunks.push({ 
        text: chunk, 
        page: estimatedPage 
      });
      
      startPos = endPos - config.chunkOverlap;
      if (startPos >= text.length) break;
    }
  }
  
  return chunks;
}

/**
 * Indexiert einen Batch von Dokumenten in Azure AI Search
 */
async function indexBatch(searchClient, documents) {
  try {
    // Azure Search hat eine maximale Batchgröße (Standard: 1000)
    // Wir begrenzen auf 100 für mehr Sicherheit
    const batchSize = 100;
    
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      const indexingResult = await searchClient.uploadDocuments(batch);
      
      console.log(`  Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(documents.length / batchSize)} hochgeladen: ${indexingResult.results.length} Dokumente verarbeitet`);
      
      // Prüfen, ob es Fehler gab
      const failedDocs = indexingResult.results.filter(r => !r.succeeded);
      if (failedDocs.length > 0) {
        console.warn(`  Warnung: ${failedDocs.length} Dokumente konnten nicht indiziert werden.`);
        for (const doc of failedDocs) {
          console.warn(`    Fehler für Dokument ${doc.key}: ${doc.errorMessage}`);
        }
      }
    }
  } catch (error) {
    console.error('  Fehler beim Indexieren des Batches:', error);
    throw error;
  }
}

// Informationen zum Verwendung anzeigen
function displayUsage() {
  console.log(`
Dokument-Indexierer für Azure AI Chat Application
------------------------------------------------

Indexiert Dokumente (PDF, DOCX, TXT) für die Verwendung im Azure AI Chatbot.

Verwendung:
  1. Legen Sie die benötigten Umgebungsvariablen in einer .env-Datei fest
  2. Speichern Sie Ihre Dokumente im Verzeichnis "${config.documentsDir}"
  3. Führen Sie "npm run index-docs" aus

Benötigte Umgebungsvariablen:
  AZURE_SEARCH_ENDPOINT       - URL Ihres Azure AI Search Dienstes
  AZURE_SEARCH_API_KEY        - Admin-API-Schlüssel Ihres Azure AI Search Dienstes
  AZURE_SEARCH_INDEX_NAME     - Name des zu erstellenden/verwendenden Index (Optional)
  
  Für Azure Blob Storage Upload (Optional):
  AZURE_STORAGE_CONNECTION_STRING - Connection String für Azure Storage
  AZURE_STORAGE_CONTAINER_NAME    - Name des Blob Containers (Optional)

Unterstützte Dateiformate:
  - PDF (.pdf)
  - Microsoft Word (.docx)
  - Text (.txt)
  - Markdown (.md)
  - HTML (.html)
`);
}

// Starte die Indexierung, wenn das Skript direkt ausgeführt wird
if (require.main === module) {
  // Zeige Verwendungshinweise an, wenn --help als Parameter übergeben wurde
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    displayUsage();
    process.exit(0);
  }
  
  // Führe die Indexierung durch
  indexDocuments().catch(err => {
    console.error('Unbehandelter Fehler:', err);
    process.exit(1);
  });
}

// Exportiere Funktionen für die Verwendung in anderen Modulen
module.exports = {
  indexDocuments,
  extractTextFromPdf,
  extractTextFromDocx,
  chunkText,
  indexBatch
};