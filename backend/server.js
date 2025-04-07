// Import required dependencies
const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Check for required environment variables
const requiredEnvVars = [
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_DEPLOYMENT_NAME'
];

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`Error: Environment variable ${varName} is not set`);
    process.exit(1);
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Normalize Azure OpenAI endpoint URL
const normalizeEndpoint = (endpoint) => {
  if (!endpoint.endsWith('/')) {
    return endpoint + '/';
  }
  return endpoint;
};

const azureEndpoint = normalizeEndpoint(process.env.AZURE_OPENAI_ENDPOINT);
const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
const apiKey = process.env.AZURE_OPENAI_API_KEY;

// API endpoint to handle chat requests
app.post('/api/chat', async (req, res) => {
  try {
    // Validate request body
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Configure request to Azure OpenAI API
    const apiUrl = `${azureEndpoint}openai/deployments/${deploymentName}/chat/completions?api-version=2023-05-15`;
    
    const response = await axios.post(
      apiUrl,
      {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: message }
        ],
        max_tokens: 800
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        }
      }
    );

    // Extract and return the bot's reply
    const botReply = response.data.choices[0].message.content;
    return res.json({ reply: botReply });
    
  } catch (error) {
    console.error('Error communicating with Azure OpenAI API:', error.message);
    
    // Provide more detailed error information for debugging
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    
    return res.status(500).json({ 
      error: 'Failed to get response from Azure OpenAI API',
      details: error.message
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});