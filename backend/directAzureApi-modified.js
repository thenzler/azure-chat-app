const axios = require('axios');

/**
 * Sendet eine direkte Anfrage an die Azure OpenAI API mit "Your Data"-Funktionalität
 * Enthält Fehlerbehandlung und Rate-Limit-Optimierungen
 */
async function sendDirectApiRequest(endpoint, apiKey, deploymentName, messages, dataSources) {
  try {
    // Verwende eine ältere, stabilere API-Version
    const url = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=2023-09-01-preview`;
    
    // Reduzierte Token-Anzahl und optimierte Datenquellen-Konfiguration
    const requestBody = {
      messages,
      temperature: 0.1,
      max_tokens: 400, // Reduziert für weniger Token-Verbrauch
      data_sources: dataSources.map(ds => {
        // Umwandlung von camelCase zu snake_case für die API
        if (ds.type === "azure_search") {
          return {
            type: ds.type,
            parameters: {
              endpoint: ds.parameters.endpoint,
              key: ds.parameters.key,
              index_name: ds.parameters.indexName,
              role_information: ds.parameters.roleInformation ? 
                ds.parameters.roleInformation.substring(0, 500) + "..." : "", // Gekürzte Rolleninformation
              fields_mapping: {
                content_fields: ds.parameters.fieldsMapping.contentFields,
                title_field: ds.parameters.fieldsMapping.titleField,
                url_field: ds.parameters.fieldsMapping.urlField,
                filepath_field: ds.parameters.fieldsMapping.filepathField,
                vector_fields: ds.parameters.fieldsMapping.vectorFields || []
              }
            }
          };
        }
        return ds;
      })
    };
    
    console.log("[DEBUG] Direkter API-Aufruf mit optimierter Payload");
    
    // Timeout erhöhen und Retries einbauen
    const response = await axios.post(url, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      timeout: 120000 // 2 Minuten Timeout
    });
    
    return response.data;
  } catch (error) {
    // Detaillierte Fehlerbehandlung
    if (error.response && error.response.status === 429) {
      console.error("[ERROR] Rate Limit erreicht:", 
        error.response.data?.error?.message || "Unbekannter Rate-Limit-Fehler");
      
      // Werfe speziellen Fehler mit Code für die Retry-Logik
      const rateLimitError = new Error(
        error.response.data?.error?.message || "Rate limit exceeded"
      );
      rateLimitError.code = '429';
      throw rateLimitError;
    } else if (error.response) {
      console.error("[ERROR] API-Fehler:", 
        error.response.status,
        error.response.data?.error?.message || error.response.data);
    } else {
      console.error("[ERROR] Netzwerk- oder Timeout-Fehler:", error.message);
    }
    
    throw error;
  }
}

/**
 * Sendet eine direkte Anfrage mit automatischen Wiederholungsversuchen
 */
async function sendDirectApiRequestWithRetry(endpoint, apiKey, deploymentName, messages, dataSources, 
  maxRetries = 3, initialDelay = 65000) {
  
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await sendDirectApiRequest(endpoint, apiKey, deploymentName, messages, dataSources);
    } catch (error) {
      lastError = error;
      
      if (error.code === '429') {
        // Bei Rate-Limit-Fehler: Warten und erneut versuchen
        if (attempt < maxRetries - 1) {
          const delayMs = initialDelay * (attempt + 1); // Progressives Backoff
          console.warn(`[WARN] Rate limit erreicht. Warte ${delayMs/1000} Sekunden vor Retry #${attempt + 1}...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
      }
      
      // Bei anderen Fehlern oder wenn alle Retries fehlgeschlagen sind
      throw error;
    }
  }
  
  throw lastError;
}

module.exports = { 
  sendDirectApiRequest,
  sendDirectApiRequestWithRetry
};