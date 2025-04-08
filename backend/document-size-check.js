// Simple script to check document sizes in the index
require('dotenv').config();
const { AzureKeyCredential } = require('@azure/core-auth');
const { SearchClient } = require('@azure/search-documents');

// Azure Search client
const searchClient = new SearchClient(
  process.env.AZURE_SEARCH_ENDPOINT,
  process.env.AZURE_SEARCH_INDEX_NAME,
  new AzureKeyCredential(process.env.AZURE_SEARCH_API_KEY)
);

async function checkDocumentSizes() {
  console.log(`Checking document sizes in index: ${process.env.AZURE_SEARCH_INDEX_NAME}`);
  
  try {
    // Get a small sample of documents
    const searchResults = await searchClient.search("*", {
      select: ["content", "title", "filepath", "filename"],
      top: 5
    });
    
    console.log("Sample document sizes:");
    let index = 1;
    
    for await (const result of searchResults.results) {
      if (result.document) {
        const contentLength = result.document.content ? result.document.content.length : 0;
        const contentTokenEstimate = Math.ceil(contentLength / 4);
        
        console.log(`Document ${index++}:`);
        console.log(`  Title: ${result.document.title || result.document.filename || "Unknown"}`);
        console.log(`  Content length: ${contentLength} characters`);
        console.log(`  Estimated tokens: ~${contentTokenEstimate} tokens`);
        console.log(`  Fields: ${Object.keys(result.document).join(", ")}`);
        console.log("---");
      }
    }
    
    console.log("RECOMMENDATION:");
    console.log("If any single document has > 10,000 tokens, you need to re-index your documents into smaller chunks");
    console.log("Consider using the 'max_tokens_per_chunk' parameter in your indexer to limit chunk sizes");
  } catch (error) {
    console.error("Error checking document sizes:", error);
  }
}

// Run the check
checkDocumentSizes();
