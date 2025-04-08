# Anleitung zur Behebung von Token-Limit-Problemen

Diese Anleitung beschreibt, wie Sie das Token-Limit-Problem mit dem Azure Chat App beheben können.

## Hintergrund des Problems

Die Fehlermeldung:
```
This model's maximum context length is 16385 tokens. However, your messages resulted in 161459 tokens. Please reduce the length of the messages.
```

Dies bedeutet, dass Ihre Anfrage (mit allen Dokumenteninhalten) die maximale Kontextgröße des Modells drastisch überschreitet. Jedes Azure OpenAI-Modell hat ein festes Token-Limit (für gpt-35-turbo-16k sind es 16.385 Token).

## Schnelle Lösung

### 1. Optimierte Token-Limit-Datei verwenden

Wir haben eine spezielle Version des Servers erstellt, die das Token-Problem bewältigt:

- `server-token-limit-fix.js`: Eine Version mit strikter Token-Begrenzung

Um diese zu verwenden:

```bash
# Backup der originalen Datei erstellen
cp server.js server.js.bak

# Token-Limit-Fix-Version übernehmen
cp server-token-limit-fix.js server.js

# Server neu starten
npm start
```

### 2. Richtiges Modell in .env konfigurieren

Stellen Sie sicher, dass Sie das richtige Modell verwenden und die Modellparameter korrekt eingestellt sind:

```
# In .env-Datei
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-35-turbo-16k
```

## Wichtige Änderungen in der Token-Limit-Fix-Version

1. **Drastisch reduzierte Dokumentenverarbeitung**:
   - Nur 2 Dokumente statt 10-15
   - Maximal 200 Zeichen pro Dokument
   - Extrem gekürzter System-Prompt

2. **Token-Schätzung und -Begrenzung**:
   - Schätzung der Token-Anzahl für jeden Teil der Anfrage
   - Automatische Begrenzung der Dokumentenanzahl basierend auf Token-Limits
   - Benutzerfreundliche Fehlermeldungen bei Überschreitung des Limits

3. **Modellparameter-Anpassungen**:
   - Konfigurierbare Modellgrenzwerte (MAX_MODEL_TOKENS, MAX_COMPLETION_TOKENS)
   - Automatische Berechnung des verfügbaren Kontextraums

## Anpassung der Token-Limits

Sie können die Token-Grenzwerte in der Datei an Ihr spezifisches Modell anpassen:

```javascript
// Für gpt-35-turbo-16k
const MAX_MODEL_TOKENS = 16000; 
const MAX_COMPLETION_TOKENS = 1000;

// Für gpt-4-32k
// const MAX_MODEL_TOKENS = 32000;
// const MAX_COMPLETION_TOKENS = 2000;
```

## Langfristige Lösungen

Für eine nachhaltige Lösung sollten Sie einen dieser Schritte in Betracht ziehen:

1. **Auf ein Modell mit größerem Kontext umsteigen**:
   - gpt-4-32k (32.000 Token)
   - Beachten Sie, dass größere Modelle oft höhere Kosten und niedrigere Rate-Limits haben

2. **Chunking-Strategie optimieren**:
   - Überarbeiten Sie die Dokumentindexierung, um kleinere, semantisch sinnvollere Chunks zu erstellen
   - Verbessern Sie das Ranking der relevantesten Dokumentabschnitte

3. **Vektor-basierten Ansatz verwenden**:
   - Implementieren Sie einen Embedding-basierten Ansatz mit semantischer Suche
   - Speichern Sie Dokumenteinbettungen im Azure AI Search-Index
   - Suchen Sie nach den semantisch ähnlichsten Dokumenten

4. **Mehrschritt-Prozess implementieren**:
   - Erste Phase: Identifizieren der relevantesten Dokumente
   - Zweite Phase: Detaillierte Antwortgenerierung nur mit den wichtigsten Dokumenten

## FAQ

**F: Warum ist die Antwortqualität niedriger?**  
A: Die drastische Reduzierung der Dokumentinhalte kann die Antwortqualität beeinträchtigen. Dies ist ein Kompromiss, um das Token-Limit-Problem zu lösen.

**F: Warum sehe ich weniger Quellenangaben?**  
A: Da weniger Dokumente und kürzere Inhalte verwendet werden, sind auch weniger Quellenangaben möglich.

**F: Kann ich zu viele Dokumente in meinem Index haben?**  
A: Die Anzahl der Dokumente im Index ist nicht das Problem. Das Problem entsteht, wenn zu viele Dokumentabschnitte für eine einzelne Anfrage zurückgegeben werden.

## Zusätzliche Optimierungen

- Implementieren Sie eine Client-seitige Begrenzung der Anfragelänge
- Fügen Sie eine Anzeige für die geschätzte Anzahl der gefundenen Dokumente hinzu
- Ermöglichen Sie den Benutzern, ihre Anfrage zu verfeinern, wenn zu viele Dokumente gefunden werden

Bei weiteren Problemen wenden Sie sich an den Azure-Support für zusätzliche Beratung zu Modellgrenzen und Optimierungen.