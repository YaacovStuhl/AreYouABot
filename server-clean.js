const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    if (req.url === '/' || req.url === '/index.html') {
        const filePath = path.join(__dirname, 'standalone.html');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404, {'Content-Type': 'text/plain'});
                res.end('File not found');
                return;
            }
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end(data);
        });
    } else if (req.url === "/api/chat" && req.method === "POST") {
        let body = "";
        req.on("data", chunk => {
            body += chunk.toString();
        });
        req.on("end", async () => {
            try {
                const data = JSON.parse(body);
                const response = await getAIResponse(data.message);
                
                setTimeout(() => {
                    res.writeHead(200, {"Content-Type": "application/json"});
                    res.end(JSON.stringify({ response: response }));
                }, 1000 + Math.random() * 2000);
            } catch (error) {
                res.writeHead(400, {"Content-Type": "application/json"});
                res.end(JSON.stringify({ error: "Invalid request" }));
            }
        });
    } else {
        res.writeHead(404, {'Content-Type': 'text/plain'});
        res.end('Not found');
    }
});

const PORT = process.env.PORT || 3001;
async function getAIResponse(message) {
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: message,
                conversationHistory: gameState.messages || []
            })
        });
        
        const data = await response.json();
        return data.response || "I'm having trouble thinking right now.";
    } catch (error) {
        console.error('AI request failed:', error);
        return "I'm having trouble thinking right now.";
    }
}
server.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
    console.log('Open http://localhost:3001 in your browser');
});