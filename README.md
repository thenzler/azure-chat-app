# Azure AI Chat Application

A full-stack web application that serves as a UI wrapper for the Azure OpenAI API. This application provides a clean, responsive chat interface that communicates with Azure's AI services through a secure backend proxy.

## 📋 Features

- Modern, responsive chat UI with a clean design
- Realtime chat interactions with typing indicators
- Secure integration with Azure OpenAI API
- Cross-browser and mobile compatibility
- Auto-expanding text input area

## 🛠️ Technology Stack

### Frontend
- HTML5
- CSS3 with custom variables and responsive design
- Vanilla JavaScript (no frameworks)

### Backend
- Node.js with Express
- Environment-based configuration
- CORS support
- Axios for HTTP requests

## 🚀 Getting Started

### Prerequisites

- Node.js (v14 or higher)
- An Azure OpenAI service instance
- API keys for your Azure OpenAI service

### Installation

1. Clone the repository
```bash
git clone https://github.com/thenzler/azure-chat-app.git
cd azure-chat-app
```

2. Install backend dependencies
```bash
cd backend
npm install
```

3. Configure environment variables
```bash
# Copy the example .env file
cp .env.example .env

# Edit the .env file with your Azure OpenAI credentials
nano .env
```

4. Start the backend server
```bash
npm start
```

5. Open the frontend
```bash
# In a new terminal, navigate to the project root
cd ../frontend

# Open index.html in your browser
# You can use a local server like `live-server` or simply open the file in your browser
```

## ⚙️ Configuration

The application requires the following environment variables:

- `AZURE_OPENAI_API_KEY`: Your Azure OpenAI API key
- `AZURE_OPENAI_ENDPOINT`: Your Azure OpenAI service endpoint URL
- `AZURE_OPENAI_DEPLOYMENT_NAME`: The deployment name of your Azure OpenAI model
- `PORT`: The port for the backend server (default: 3000)

## 🧪 Testing

### Backend

You can test the backend API using tools like Postman or curl:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello, how are you?"}'
```

### Frontend

The frontend can be tested by opening `index.html` in different browsers and screen sizes to ensure responsive design functionality.

## 🔒 Security Considerations

- API keys are stored in environment variables, not hardcoded
- CORS is enabled to restrict access to known origins
- Input validation is performed on both client and server
- Error handling avoids exposing sensitive information

## 🔧 Customization

### UI Theme

You can customize the UI by modifying the CSS variables in the `:root` section of the `style.css` file.

### Chat Behavior

To modify the chat behavior, adjust the parameters in the API call within `server.js`, such as `max_tokens`, system prompt, etc.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.