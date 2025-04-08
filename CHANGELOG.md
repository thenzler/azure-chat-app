# Changelog

## 2025-04-08: General Knowledge Fallback & Token Limit Control

### Neue Funktionen
- **Fallback zu allgemeinem Wissen**: Wenn keine relevanten Dokumente für eine Anfrage gefunden werden, gibt der Chatbot jetzt nicht nur eine "keine Informationen" Nachricht zurück, sondern kann zusätzlich eine allgemeine Antwort basierend auf seinem eigenen Wissen liefern.
  - Antworten aus allgemeinem Wissen werden deutlich mit "[Allgemeinwissen]:" gekennzeichnet.
  - Dokumentenbasierte Informationen werden weiterhin mit "(Quelle: Dokumentname, Seite X)" zitiert.

### Verbesserungen
- **Token-Limit-Kontrolle**: Implementierung von Schutzmaßnahmen gegen das Überschreiten des maximalen Token-Limits des Azure OpenAI-Modells.
  - Automatische Schätzung der Tokengröße und Begrenzung der Gesamtzahl der Tokens im Kontext.
  - Kürzung großer Dokumente, um innerhalb der Grenzwerte zu bleiben.
  - Reduzierte Anzahl der zurückgegebenen Dokumente (von 15 auf 10 für normale Suche, von 10 auf 5 für einfache Suche).

### Technische Änderungen
- **Modifizierter System-Prompt**: Der System-Prompt wurde aktualisiert, um die Verwendung von allgemeinem Wissen als Fallback zu ermöglichen.
- **Überarbeitete Dokumentverarbeitung**: Die Dokumentverarbeitung wurde verbessert, um die Token-Nutzung zu optimieren und Größenbeschränkungen zu implementieren.
- **Erweiterte Logging**: Zusätzliche Logs zur Überwachung der geschätzten Token-Anzahl und Dokument-Kürzung.

### Nutzen für Endbenutzer
- Benutzer erhalten jetzt hilfreiche Antworten, auch wenn keine spezifischen Informationen in den indizierten Dokumenten gefunden werden.
- Verbesserter Umgang mit großen Dokumentmengen, was zu weniger "Kontext zu groß"-Fehlern führt.
- Klare Unterscheidung zwischen dokumentbasierten Informationen (mit Quellenangaben) und allgemeinem Wissen (mit "[Allgemeinwissen]:" gekennzeichnet).
