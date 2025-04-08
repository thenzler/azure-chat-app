# Anleitung zur Behebung von Rate-Limit-Problemen

Diese Anleitung beschreibt, wie Sie das Rate-Limit-Problem (HTTP 429) mit dem Azure Chat App beheben können.

## Hintergrund des Problems

Die Fehlermeldung:
```
Requests to the ChatCompletions_Create Operation under Azure OpenAI API version 2024-03-01-preview have exceeded token rate limit of your current OpenAI S0 pricing tier.
```

Dies bedeutet, dass Ihre Azure OpenAI S0-Dienstinstanz ein Limit für die Anzahl der Token erreicht hat, die Sie pro Minute/Stunde verarbeiten können.

## Schnelle Lösung

### 1. Optimierte Dateien verwenden

Wir haben zwei optimierte Dateien erstellt, die den Token-Verbrauch reduzieren und besser mit Rate-Limits umgehen:

- `server-modified.js`: Eine optimierte Version des Servers
- `directAzureApi-modified.js`: Eine optimierte Version der direkten API-Anfrage

Um diese zu verwenden:

```bash
# Backup der originalen Dateien erstellen
cp server.js server.js.bak
cp directAzureApi.js directAzureApi.js.bak

# Optimierte Dateien übernehmen
cp server-modified.js server.js
cp directAzureApi-modified.js directAzureApi.js

# Server neu starten
npm start
```

### 2. .env-Datei anpassen

Ergänzen oder ändern Sie folgende Einstellungen in Ihrer `.env`-Datei:

```
# Rate-Limit-Optimierungen
USE_SEMANTIC_SEARCH=false
USE_AZURE_OPENAI_DATA_FEATURE=false
```

## Wichtige Änderungen in den optimierten Dateien

1. **Reduzierte Token-Nutzung**:
   - Kürzerer System-Prompt
   - Weniger Dokumente aus der Suche (3 statt 15)
   - Reduzierte Textlänge pro Dokument (800 Zeichen statt vollständiger Text)
   - Geringere max_tokens-Einstellung (400 statt 800)

2. **Verbesserte Fehlerbehandlung**:
   - Automatische Wiederholungsversuche bei Rate-Limit-Fehlern
   - Progressives Exponential-Backoff (längere Wartezeiten nach jedem Versuch)
   - Benutzerfreundliche Fehlermeldungen an den Client

3. **API-Optimierungen**:
   - Ältere, stabilere API-Version (2023-09-01-preview)
   - Erhöhtes Request-Timeout (2 Minuten)
   - Bessere Fehlerprotokollierung

## Langfristige Lösungen

Für eine nachhaltige Lösung sollten Sie einen dieser Schritte in Betracht ziehen:

1. **Azure OpenAI-Kontingent erhöhen**:
   - Besuchen Sie: https://aka.ms/oai/quotaincrease
   - Beantragen Sie eine Erhöhung Ihres Token-pro-Minute-Limits

2. **Auf höheren Tarif upgraden**:
   - Wenn Sie einen kostenlosen Account haben, upgraden Sie auf Pay-as-you-Go
   - Oder wechseln Sie von S0 auf einen höheren Tarif

3. **Deployment-Einstellungen optimieren**:
   - Erstellen Sie ein neues Deployment mit anderen Quotaeinstellungen
   - Verwenden Sie ein effizienteres Modell (z.B. GPT-3.5 statt GPT-4 wenn möglich)

## Zusätzliche Optimierungsvorschläge

- Implementieren Sie Client-seitiges Caching für häufige Abfragen
- Fügen Sie Ratenbegrenzungen im Frontend hinzu, um zu schnelle Benutzeranfragen zu verhindern
- Betrachten Sie die Verwendung von Embeddings für effizientere Dokumentensuche
- Überprüfen und optimieren Sie das Indexschema in Azure AI Search

Bei anhaltenden Problemen wenden Sie sich an den Azure-Support für weitere Unterstützung.