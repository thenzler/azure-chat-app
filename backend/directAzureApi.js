const axios = require('axios');

/**
 * Sendet eine direkte Anfrage an die Azure OpenAI API mit "Your Data"-Funktionalität
 */
async function sendDirectApiRequest(endpoint, apiKey, deploymentName, messages, dataSources) {
  try {
    const url = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=2023-09-01-preview`;
    
    const requestBody = {
      messages,
      temperature: 0.1,
      max_tokens: 800,
      data_sources: dataSources.map(ds => {
        // Umwandlung von camelCase zu snake_case für die API
        if (ds.type === "azure_search") {
          return {
            type: ds.type,
            parameters: {
              endpoint: ds.parameters.endpoint,
              key: ds.parameters.key,
              index_name: ds.parameters.indexName,
              role_information: ds.parameters.roleInformation,
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
    
    console.log("[DEBUG] Direkter API-Aufruf mit Payload:", JSON.stringify(requestBody, null, 2));
    
    const response = await axios.post(url, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey
      }
    });
    
    return response.data;
  } catch (error) {
    console.error("[ERROR] Direkter API-Aufruf fehlgeschlagen:", error.response?.data || error.message);
    throw error;
  }
}

module.exports = { sendDirectApiRequest };