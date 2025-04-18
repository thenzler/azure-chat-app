// DOM elements
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const typingIndicator = document.getElementById('typing-indicator');

// Configuration
const BACKEND_URL = 'http://localhost:3000'; // Update this with your backend URL
const API_ENDPOINT = `${BACKEND_URL}/api/chat`;

// Event listeners
document.addEventListener('DOMContentLoaded', initializeChat);
messageInput.addEventListener('input', handleInput);
messageInput.addEventListener('keydown', handleKeyDown);
sendButton.addEventListener('click', sendMessage);

/**
 * Initialize the chat interface
 */
function initializeChat() {
    // Auto-focus the input field
    messageInput.focus();
    
    // Adjust the textarea height on input
    messageInput.addEventListener('input', autoResizeTextarea);
    
    // Test backend connection
    fetch(`${BACKEND_URL}/health`)
        .then(response => response.json())
        .then(data => {
            console.log('Backend health check successful:', data);
        })
        .catch(error => {
            console.warn('Backend health check failed:', error);
            addSystemMessage('Warnung: Verbindung zum Backend-Server konnte nicht hergestellt werden. Bitte stellen Sie sicher, dass der Server läuft.');
        });
}

/**
 * Add a system message to the chat
 */
function addSystemMessage(message) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('system-message');
    messageElement.innerHTML = message;
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
}

/**
 * Auto-resize the textarea based on content
 */
function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = (messageInput.scrollHeight) + 'px';
    
    // Limit the max height
    if (messageInput.scrollHeight > 150) {
        messageInput.style.overflowY = 'auto';
    } else {
        messageInput.style.overflowY = 'hidden';
    }
}

/**
 * Handle input change to enable/disable send button
 */
function handleInput() {
    // Enable or disable send button based on input content
    if (messageInput.value.trim()) {
        sendButton.disabled = false;
    } else {
        sendButton.disabled = true;
    }
    
    autoResizeTextarea();
}

/**
 * Handle Enter key to send message (Shift+Enter for new line)
 */
function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        
        if (!sendButton.disabled) {
            sendMessage();
        }
    }
}

/**
 * Send message to the backend API
 */
async function sendMessage() {
    const message = messageInput.value.trim();
    
    if (!message) return;
    
    // Add user message to the chat
    addMessageToChat('user', message);
    
    // Clear input and reset height
    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendButton.disabled = true;
    
    // Show typing indicator
    showTypingIndicator();
    
    try {
        console.log('Sending message to backend:', message);
        
        // Send message to backend
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message })
        });
        
        // Check if response is ok
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Error response from backend:', errorData);
            throw new Error(errorData.error || 'Failed to get a response');
        }
        
        // Parse response data
        const data = await response.json();
        console.log('Received response from backend:', data);
        
        // Hide typing indicator
        hideTypingIndicator();
        
        // Add bot message to chat with sources if available
        if (data.sources && data.sources.length > 0) {
            console.log(`Found ${data.sources.length} sources in response`);
            addMessageWithSources('bot', data.reply, data.sources);
        } else {
            console.log('No sources found in response, using standard message display');
            
            // Check if the response contains source citations that weren't extracted
            const containsCitations = /\(Quelle: [^,]+, Seite \d+\)/i.test(data.reply);
            
            if (containsCitations) {
                console.log('Response contains source citations in text, extracting manually');
                // Extract sources manually
                const sources = extractSourcesFromText(data.reply);
                if (sources.length > 0) {
                    addMessageWithSources('bot', data.reply, sources);
                } else {
                    addMessageToChat('bot', data.reply);
                }
            } else {
                addMessageToChat('bot', data.reply);
            }
        }
        
    } catch (error) {
        console.error('Error:', error);
        
        // Hide typing indicator
        hideTypingIndicator();
        
        // Add error message
        addMessageToChat('bot', `Sorry, ich habe einen Fehler festgestellt: ${error.message}. Bitte versuchen Sie es später erneut.`);
    }
    
    // Focus back on input
    messageInput.focus();
}

/**
 * Extract sources from text manually
 */
function extractSourcesFromText(text) {
    const sources = [];
    const sourceRegex = /\(Quelle: ([^,]+), Seite (\d+)\)/g;
    let match;
    
    while ((match = sourceRegex.exec(text)) !== null) {
        const document = match[1].trim();
        const page = parseInt(match[2]);
        
        // Only add unique sources
        if (!sources.some(s => s.document === document && s.page === page)) {
            sources.push({ document, page });
        }
    }
    
    return sources;
}

/**
 * Add a message to the chat interface
 */
function addMessageToChat(sender, content) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', sender === 'user' ? 'user-message' : 'bot-message');
    
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    messageElement.innerHTML = `
        <div class="message-bubble">${formatMessageContent(content)}</div>
        <div class="timestamp">${timestamp}</div>
    `;
    
    messagesContainer.appendChild(messageElement);
    
    // Scroll to the bottom
    scrollToBottom();
}

/**
 * Add a message with source citations to the chat
 */
function addMessageWithSources(sender, content, sources) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', sender === 'user' ? 'user-message' : 'bot-message');
    
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Format the content with highlighted source tags
    const formattedContent = formatMessageWithSources(content);
    
    let sourceListHTML = '';
    if (sources && sources.length > 0) {
        sourceListHTML = `
            <div class="source-list">
                <div class="source-list-title">Quellen:</div>
                ${sources.map(source => `
                    <div class="source-item">
                        <span class="source-icon">📄</span>
                        <span>${source.document}, Seite ${source.page}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    messageElement.innerHTML = `
        <div class="message-bubble">
            ${formattedContent}
            ${sourceListHTML}
        </div>
        <div class="timestamp">${timestamp}</div>
    `;
    
    messagesContainer.appendChild(messageElement);
    
    // Scroll to the bottom
    scrollToBottom();
}

/**
 * Format message content (handle newlines, etc.)
 */
function formatMessageContent(content) {
    // Replace newlines with <br> tags
    let formatted = content.replace(/\n/g, '<br>');
    
    // Attempt to highlight any source citations anyway
    formatted = formatMessageWithSources(formatted);
    
    return formatted;
}

/**
 * Format message with highlighted source tags
 */
function formatMessageWithSources(content) {
    // Replace newlines with <br> tags
    let formatted = content.replace(/\n/g, '<br>');
    
    // Highlight source citations
    formatted = formatted.replace(/\(Quelle: ([^,]+), Seite (\d+)\)/g, 
        '<span class="source-tag">$1, S.$2</span>');
    
    return formatted;
}

/**
 * Show the typing indicator
 */
function showTypingIndicator() {
    typingIndicator.style.display = 'block';
    scrollToBottom();
}

/**
 * Hide the typing indicator
 */
function hideTypingIndicator() {
    typingIndicator.style.display = 'none';
}

/**
 * Scroll to the bottom of the messages container
 */
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}