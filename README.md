# Azure AI Chat Application

Eine Full-Stack-Webanwendung, die als UI-Wrapper für Azure OpenAI API mit Dokumenten-Referenzierung dient. Diese Anwendung bietet eine moderne, responsive Chat-Oberfläche, die über einen sicheren Backend-Proxy mit Azure AI-Diensten kommuniziert.

## 📋 Features

- Moderne, responsive Chat-UI mit klarem Design
- Echtzeitinteraktionen mit Tippindikatoren
- Sichere Integration mit Azure OpenAI API
- Dokumenten-Indexierung und -Referenzierung mit Azure AI Search
- Quellenangaben für alle Informationen aus Dokumenten
- Cross-Browser und Mobilgeräte-Kompatibilität
- Auto-expandierendes Texteingabefeld

## 🛠️ Technologie-Stack

### Frontend
- HTML5
- CSS3 mit benutzerdefinierten Variablen und responsive Design
- Vanilla JavaScript (ohne Frameworks)

### Backend
- Node.js mit Express
- Umgebungsbasierte Konfiguration
- CORS-Unterstützung
- Axios für HTTP-Anfragen
- Azure AI Search für Dokumentensuche
- Azure Blob Storage für Dokumentenspeicherung (optional)

## 🚀 Erste Schritte

### Voraussetzungen

- Node.js (v16 oder höher)
- Eine Azure OpenAI Service-Instanz
- Eine Azure AI Search-Instanz
- API-Schlüssel für Azure-Dienste

### Installation

1. Repository klonen
```bash
git clone https://github.com/thenzler/azure-chat-app.git
cd azure-chat-app
```

2. Backend-Abhängigkeiten installieren
```bash
cd backend
npm install
```

3. Umgebungsvariablen konfigurieren
```bash
# Beispiel-.env-Datei kopieren
cp .env.example .env

# .env-Datei mit Ihren Azure-Anmeldeinformationen bearbeiten
nano .env
```

4. Dokumente indexieren (optional)
```bash
# Erstellen Sie den Ordner "documents" und fügen Sie Ihre Dateien hinzu
mkdir -p documents
# Kopieren Sie Ihre PDF-, DOCX- oder TXT-Dateien in den Ordner "documents"

# Führen Sie das Indexierungsskript aus
npm run index-docs
```

5. Backend-Server starten
```bash
npm start
```

6. Frontend öffnen
```bash
# In einem neuen Terminal zum Projektstammverzeichnis navigieren
cd ../frontend

# index.html im Browser öffnen
# Sie können einen lokalen Server wie `live-server` verwenden oder die Datei einfach im Browser öffnen
```

## ⚙️ Konfiguration

Die Anwendung benötigt die folgenden Umgebungsvariablen:

### Grundlegende Konfiguration
- `PORT`: Der Port für den Backend-Server (Standard: 3000)

### Azure OpenAI Konfiguration
- `AZURE_OPENAI_API_KEY`: Ihr Azure OpenAI API-Schlüssel
- `AZURE_OPENAI_ENDPOINT`: Die Endpunkt-URL Ihres Azure OpenAI-Dienstes
- `AZURE_OPENAI_DEPLOYMENT_NAME`: Der Deployment-Name Ihres Azure OpenAI-Modells

### Azure AI Search Konfiguration
- `AZURE_SEARCH_ENDPOINT`: Die Endpunkt-URL Ihres Azure AI Search-Dienstes
- `AZURE_SEARCH_API_KEY`: Ihr Azure AI Search API-Schlüssel
- `AZURE_SEARCH_INDEX_NAME`: Der Name des zu verwendenden Suchindex (Standard: "knowledge-index")

### Azure Blob Storage Konfiguration (optional)
- `AZURE_STORAGE_CONNECTION_STRING`: Die Verbindungszeichenfolge für Ihren Azure Storage-Account
- `AZURE_STORAGE_CONTAINER_NAME`: Der Name des Blob-Containers (Standard: "documents")

## 📑 Dokumente indexieren

Die Anwendung kann Dokumente in verschiedenen Formaten (PDF, DOCX, TXT) indexieren und in Azure AI Search speichern, sodass der Chatbot auf diese Dokumente Bezug nehmen kann.

### Unterstützte Formate

- PDF-Dateien (*.pdf)
- Microsoft Word-Dokumente (*.docx)
- Textdateien (*.txt, *.md, *.html)

### Indexierungsprozess

1. Legen Sie Ihre Dokumente im Ordner `documents` ab
2. Führen Sie den Indexierungsbefehl aus:
   ```bash
   npm run index-docs
   ```
3. Der Indexer extrahiert den Text aus den Dokumenten, teilt ihn in sinnvolle Abschnitte auf und lädt diese in Azure AI Search hoch
4. Optional werden die Originaldokumente in Azure Blob Storage hochgeladen

### Seitenreferenzen

Der Indexer versucht, Seitennummern aus PDF-Dokumenten zu extrahieren. Bei anderen Dokumenttypen ohne Seitenunterbrechungen wird die Seitenzahl anhand der Position im Dokument geschätzt.

## 🧪 Testen

### Backend

Sie können die Backend-API mit Tools wie Postman oder curl testen:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Was ist der Hauptzweck des Projekts?"}'
```

### Dokumentensuche testen

Verwenden Sie den eingebauten Endpunkt zum Testen der Dokumentensuche:

```bash
curl "http://localhost:3000/api/test-search?q=Hauptzweck"
```

### Frontend

Das Frontend kann getestet werden, indem Sie `index.html` in verschiedenen Browsern und Bildschirmgrößen öffnen, um die Funktionalität des responsive Designs sicherzustellen.

## 🔒 Sicherheitsüberlegungen

- API-Schlüssel werden in Umgebungsvariablen gespeichert, nicht hartcodiert
- CORS ist aktiviert, um den Zugriff auf bekannte Ursprünge zu beschränken
- Eingabevalidierung wird sowohl auf dem Client als auch auf dem Server durchgeführt
- Die Fehlerbehandlung vermeidet die Offenlegung sensibler Informationen

## 🔧 Anpassung

### UI-Theme

Sie können die Benutzeroberfläche anpassen, indem Sie die CSS-Variablen im Abschnitt `:root` der Datei `style.css` ändern.

### Chat-Verhalten

Um das Chat-Verhalten zu ändern, passen Sie die Parameter im API-Aufruf in `server.js` an, wie z.B. `max_tokens`, Systemprompt usw.

### Indexierungsoptionen

Die Indexierungsoptionen können in der Datei `document-indexer.js` angepasst werden, einschließlich:
- `chunkSize`: Die Anzahl der Zeichen pro Abschnitt (Standard: 1000)
- `chunkOverlap`: Die Überlappung zwischen Abschnitten (Standard: 200)
- `documentsDir`: Das Verzeichnis, in dem Dokumente gespeichert werden (Standard: "./documents")

## 🤝 Mitwirken

Beiträge sind willkommen! Bitte reichen Sie gerne einen Pull Request ein.

## 📄 Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert – siehe die LICENSE-Datei für Details.