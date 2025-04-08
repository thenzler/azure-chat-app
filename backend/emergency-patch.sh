#!/bin/bash

# Emergency patch script for token limit issues
echo "Creating backup of current server.js..."
cp server.js server.js.backup

echo "Patching server.js to limit token usage..."

# Use sed to modify the server.js file directly
# 1. Limit search results to 1 document
sed -i 's/top: [0-9]\+/top: 1/g' server.js

# 2. Truncate document content to max 100 characters
sed -i 's/contextText += `Inhalt: ${doc.content}/contextText += `Inhalt: ${doc.content.substring(0, 100) + "..."}/g' server.js

# 3. Reduce tokens in system prompt
sed -i 's/const SYSTEM_PROMPT = `Du bist ein präziser Recherche-Assistent/const SYSTEM_PROMPT = `Du bist ein kurzer Recherche-Assistent/g' server.js

echo "Emergency patch complete. Please restart the server."
echo "Your original file is saved as server.js.backup"
