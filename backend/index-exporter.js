// Index-Exporter für Azure AI Chat Application
// Dieses Skript exportiert alle Indizes aus Azure AI Search als CSV-Datei

const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
const { writeFile } = require('fs/promises');
const { join } = require('path');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs').promises;

// Lade Umgebungsvariablen
dotenv.config();

// Konfiguration
const config = {
  // Azure AI Search
  searchEndpoint: process.env.AZURE_SEARCH_ENDPOINT,
  searchApiKey: process.env.AZURE_SEARCH_API_KEY,
  searchIndexName: process.env.AZURE_SEARCH_INDEX_NAME || 'knowledge-index',
  
  // Export-Optionen
  exportDir: './exports', // Verzeichnis für den Export
  maxResults: 1000, // Maximale Anzahl an Ergebnissen (kann angepasst werden)
};

// Prüfung der benötigten Umgebungsvariablen
const requiredEnvVars = [
  'AZURE_SEARCH_ENDPOINT',
  'AZURE_SEARCH_API_KEY'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Fehler: Umgebungsvariable ${envVar} ist nicht gesetzt.`);
    process.exit(1);
  }
}

/**
 * Hauptfunktion zum Exportieren des Index als CSV
 */
async function exportIndexToCSV() {
  console.log('Starte Export des Azure AI Search Index als CSV...');
  
  try {
    // 1. Initialisiere Azure AI Search Client
    const searchClient = new SearchClient(
      config.searchEndpoint,
      config.searchIndexName,
      new AzureKeyCredential(config.searchApiKey)
    );
    
    // 2. Stelle sicher, dass das Export-Verzeichnis existiert
    try {
      await fs.mkdir(config.exportDir, { recursive: true });
      console.log(`Export-Verzeichnis ${config.exportDir} ist bereit.`);
    } catch (error) {
      console.error(`Fehler beim Erstellen des Export-Verzeichnisses:`, error);
      throw error;
    }
    
    // 3. Hole alle Dokumente aus dem Index
    console.log(`Hole Dokumente aus dem Index "${config.searchIndexName}"...`);
    
    const searchOptions = {
      select: ["*"],
      top: config.maxResults,
      orderBy: ["id"]
    };
    
    const searchResults = await searchClient.search("*", searchOptions);
    
    // 4. Verarbeite die Ergebnisse
    const documents = [];
    const fields = {
      id: true,
      content: true,
      title: true,
      filepath: true,
      filename: true,
      url: true,
      chunk_id: true
    };
    
    let documentCount = 0;
    for await (const result of searchResults.results) {
      documentCount++;
      
      // Dynamische Feldmappings identifizieren
      const doc = result.document;
      if (documentCount === 1) {
        console.log(`Gefundene Felder im ersten Dokument:`, Object.keys(doc));
      }
      
      // Versuche, die Felder aus dem Dokument zu extrahieren oder setze leere Werte
      const formattedDoc = {
        id: doc.id || doc.document_id || '',
        content: doc.content || doc.text || '',
        title: doc.title || doc.document_name || '',
        filepath: doc.filepath || doc.file_path || '',
        filename: doc.filename || doc.file_name || doc.document_name || '',
        url: doc.url || doc.document_url || '',
        chunk_id: doc.chunk_id || doc.chunk_number || doc.id || ''
      };
      
      documents.push(formattedDoc);
      
      // Aktualisiere die erkannten Felder
      if (documentCount % 100 === 0) {
        console.log(`${documentCount} Dokumente verarbeitet...`);
      }
    }
    
    console.log(`Insgesamt ${documents.length} Dokumente aus dem Index geladen.`);
    
    // 5. Konvertiere zu CSV
    console.log('Konvertiere zu CSV...');
    const csvContent = convertToCSV(documents);
    
    // 6. Speichere CSV-Datei
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const filename = `${config.searchIndexName}_export_${timestamp}.csv`;
    const filePath = join(config.exportDir, filename);
    
    await fs.writeFile(filePath, csvContent, 'utf8');
    console.log(`CSV-Export erfolgreich gespeichert: ${filePath}`);
    
    return { filePath, documentCount: documents.length };
    
  } catch (error) {
    console.error('Fehler beim Export:', error);
    if (error.response) {
      console.error('API-Fehlermeldung:', error.response.data);
    }
    throw error;
  }
}

/**
 * Konvertiert ein Array von Objekten in CSV-Format
 */
function convertToCSV(objects) {
  if (objects.length === 0) {
    return '';
  }
  
  // Header mit allen Feldnamen
  const header = Object.keys(objects[0]).join(',');
  
  // Zeilen mit Daten
  const rows = objects.map(obj => {
    return Object.values(obj).map(value => {
      // Behandlung von Strings mit Kommas, Zeilenumbrüchen oder Anführungszeichen
      if (typeof value === 'string') {
        // Ersetze doppelte Anführungszeichen durch zwei doppelte Anführungszeichen
        value = value.replace(/"/g, '""');
        // Umschließe den String mit Anführungszeichen, wenn er Kommas, Zeilenumbrüche oder Anführungszeichen enthält
        if (value.includes(',') || value.includes('\n') || value.includes('"') || value.includes('\r')) {
          value = `"${value}"`;
        }
      } else if (value === undefined || value === null) {
        value = '';
      }
      return value;
    }).join(',');
  }).join('\n');
  
  return `${header}\n${rows}`;
}

/**
 * Informationen zur Verwendung anzeigen
 */
function displayUsage() {
  console.log(`
Index-Exporter für Azure AI Chat Application
--------------------------------------------

Exportiert alle Dokumente aus dem Azure AI Search Index als CSV-Datei.

Verwendung:
  1. Legen Sie die benötigten Umgebungsvariablen in einer .env-Datei fest
  2. Führen Sie "npm run export-index" aus

Benötigte Umgebungsvariablen:
  AZURE_SEARCH_ENDPOINT       - URL Ihres Azure AI Search Dienstes
  AZURE_SEARCH_API_KEY        - Admin-API-Schlüssel Ihres Azure AI Search Dienstes
  AZURE_SEARCH_INDEX_NAME     - Name des zu exportierenden Index

Der Export wird im Verzeichnis "${config.exportDir}" gespeichert.
`);
}

// Starte den Export, wenn das Skript direkt ausgeführt wird
if (require.main === module) {
  // Zeige Verwendungshinweise an, wenn --help als Parameter übergeben wurde
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    displayUsage();
    process.exit(0);
  }
  
  // Führe den Export durch
  exportIndexToCSV().catch(err => {
    console.error('Unbehandelter Fehler:', err);
    process.exit(1);
  });
}

// Exportiere Funktionen für die Verwendung in anderen Modulen
module.exports = {
  exportIndexToCSV,
  convertToCSV
};
