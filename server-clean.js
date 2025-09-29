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
                const response = await getAIResponse(data.message, data.conversationHistory || []);
                
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
function getAIResponse(message, conversationHistory = []) {
    return new Promise((resolve, reject) => {
        // Prepare the conversation for OpenAI
        const messages = [
            {
                role: "system",
                content: "You are participating in a Turing Test game. You are an AI trying to convince a human that you are also human. Be natural, conversational, and human-like. Don't reveal that you're an AI. Respond as a normal person would."
            }
        ];

        // Add conversation history
        conversationHistory.forEach(msg => {
            if (msg.sender === 'user') {
                messages.push({ role: "user", content: msg.text });
            } else if (msg.sender === 'bot') {
                messages.push({ role: "assistant", content: msg.text });
            }
        });

        // Add current message
        messages.push({ role: "user", content: message });

        const postData = JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: messages,
            max_tokens: 150,
            temperature: 0.8
        });

        const options = {
            hostname: 'api.openai.com',
            port: 443,
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    if (response.choices && response.choices[0] && response.choices[0].message) {
                        resolve(response.choices[0].message.content);
                    } else {
                        resolve("I'm having trouble thinking right now. Can you try again?");
                    }
                } catch (error) {
                    resolve("I'm having trouble thinking right now. Can you try again?");
                }
            });
        });

        req.on('error', (error) => {
            resolve("I'm having trouble thinking right now. Can you try again?");
        });

        req.write(postData);
        req.end();
    });
}
server.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
    console.log('Open http://localhost:3001 in your browser');
});