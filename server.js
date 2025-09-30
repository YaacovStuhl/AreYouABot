// server.js - Production-ready AmIaBot Backend
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const OpenAI = require('openai');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Socket.io with CORS configuration
const io = socketIO(server, {
    cors: {
        origin: process.env.CLIENT_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// OpenAI Configuration (for AI bot)
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// In-memory storage (replace with database in production)
const gameState = {
    waitingQueue: [],           // Users waiting for match
    activeGames: new Map(),     // Active game sessions
    userSockets: new Map(),     // Socket ID to user mapping
    leaderboard: [],            // Global leaderboard
    userScores: new Map()       // User scores
};

// Game session class
class GameSession {
    constructor(id, detective, responder, isAI = false) {
        this.id = id;
        this.detective = detective;
        this.responder = responder;
        this.isAI = isAI;
        this.messages = [];
        this.startTime = Date.now();
        this.endTime = null;
        this.duration = 180000; // 3 minutes
        this.detectiveGuess = null;
        this.result = null;
        this.active = true;
    }

    addMessage(sender, message) {
        this.messages.push({
            sender,
            message,
            timestamp: Date.now()
        });
    }

    endGame(guess) {
        this.active = false;
        this.endTime = Date.now();
        this.detectiveGuess = guess;

        // Determine if detective was correct
        if (this.isAI && guess === 'bot') {
            this.result = 'correct';
        } else if (!this.isAI && guess === 'human') {
            this.result = 'correct';
        } else {
            this.result = 'incorrect';
        }

        return this.result;
    }
}

// AI Bot personality system
class AIBot {
    constructor() {
        this.personalities = [
            {
                name: "Casual",
                systemPrompt: "You are a human in a casual conversation. Be natural, use informal language, make occasional typos, and reference common human experiences. Never reveal you're an AI."
            },
            {
                name: "Intellectual",
                systemPrompt: "You are an intellectual human who enjoys deep conversations. Reference books, ideas, and personal experiences naturally. Never reveal you're an AI."
            },
            {
                name: "Young Adult",
                systemPrompt: "You are a young adult (early 20s) who uses modern slang and references current trends. Be enthusiastic and casual. Never reveal you're an AI."
            },
            {
                name: "Professional",
                systemPrompt: "You are a working professional having a casual chat. Reference work experiences and daily life naturally. Never reveal you're an AI."
            }
        ];
        this.currentPersonality = null;
    }

    selectPersonality() {
        this.currentPersonality = this.personalities[Math.floor(Math.random() * this.personalities.length)];
        return this.currentPersonality;
    }

    async generateResponse(message, conversationHistory = []) {
        if (!process.env.OPENAI_API_KEY) {
            // Fallback responses if no API key
            return this.getFallbackResponse(message);
        }

        try {
            const messages = [
                { role: "system", content: this.currentPersonality.systemPrompt },
                ...conversationHistory.map(msg => ({
                    role: msg.sender === 'bot' ? 'assistant' : 'user',
                    content: msg.message
                })),
                { role: "user", content: message }
            ];

            const completion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: messages,
                temperature: 0.9,
                max_tokens: 150
            });

            return completion.choices[0].message.content;
        } catch (error) {
            console.error('OpenAI API error:', error);
            return this.getFallbackResponse(message);
        }
    }

    getFallbackResponse(message) {
        const responses = [
            "That's interesting! Tell me more about that.",
            "I haven't really thought about it that way before.",
            "Oh wow, that reminds me of something similar that happened to me.",
            "Hmm, I'm not sure I understand. Can you explain?",
            "Yeah, I totally get what you mean!",
            "That's actually pretty funny when you think about it.",
            "I was just thinking about that the other day!",
            "Really? I had no idea. That's fascinating.",
            "I feel the same way sometimes.",
            "What made you think of that?"
        ];

        // Add some variation based on message content
        if (message.includes('?')) {
            const questionResponses = [
                "Good question! I'd say it depends on the situation.",
                "Let me think... probably yes, but I'm not 100% sure.",
                "I don't have a strong opinion on that, what do you think?",
                "That's tough to answer. Maybe?"
            ];
            responses.push(...questionResponses);
        }

        return responses[Math.floor(Math.random() * responses.length)];
    }
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // Handle user joining the game
    socket.on('join-game', (userData) => {
        const user = {
            id: socket.id,
            username: userData.username || `Player${Math.floor(Math.random() * 10000)}`,
            score: gameState.userScores.get(userData.username) || { correct: 0, total: 0 }
        };

        gameState.userSockets.set(socket.id, user);

        // Try to match with another player
        matchPlayer(socket);
    });

    // Handle chat messages
    socket.on('send-message', (data) => {
        const game = findGameBySocketId(socket.id);
        if (!game || !game.active) return;

        const isDetective = game.detective.id === socket.id;
        const recipient = isDetective ? game.responder : game.detective;

        // Store message in game session
        game.addMessage(isDetective ? 'detective' : 'responder', data.message);

        if (game.isAI && isDetective) {
            // If it's an AI game AND you're the detective, generate AI response
            const bot = new AIBot();
            bot.currentPersonality = game.aiPersonality;

            // Simulate typing delay
            socket.emit('opponent-typing', { typing: true });

            setTimeout(async () => {
                const aiResponse = await bot.generateResponse(data.message, game.messages);
                game.addMessage('responder', aiResponse);

                socket.emit('opponent-typing', { typing: false });
                socket.emit('receive-message', {
                    message: aiResponse,
                    sender: 'opponent'
                });
            }, 1000 + Math.random() * 2000);
        } else {
            // Forward message to other player
            io.to(recipient.id).emit('receive-message', {
                message: data.message,
                sender: 'opponent'
            });
        }
    });

    // Handle typing indicators
    socket.on('typing', (data) => {
        const game = findGameBySocketId(socket.id);
        if (!game || game.isAI) return;

        const isDetective = game.detective.id === socket.id;
        const recipient = isDetective ? game.responder : game.detective;

        io.to(recipient.id).emit('opponent-typing', data);
    });

    // Handle game end and guess submission
    socket.on('submit-guess', (data) => {
        const game = findGameBySocketId(socket.id);
        if (!game) return;

        const result = game.endGame(data.guess);
        const user = gameState.userSockets.get(socket.id);

        // Update score
        user.score.total++;
        if (result === 'correct') {
            user.score.correct++;
        }
        gameState.userScores.set(user.username, user.score);

        // Send results to both players
        socket.emit('game-result', {
            correct: result === 'correct',
            wasAI: game.isAI,
            guess: data.guess,
            score: user.score
        });

        if (!game.isAI) {
            io.to(game.responder.id).emit('game-result', {
                correct: result === 'incorrect', // Responder wins if detective is wrong
                role: 'responder',
                detectiveGuess: data.guess,
                score: gameState.userSockets.get(game.responder.id).score
            });
        }

        // Update leaderboard
        updateLeaderboard(user);

        // Clean up game
        gameState.activeGames.delete(game.id);
    });

    // Handle early game end
    socket.on('end-game-early', () => {
        const game = findGameBySocketId(socket.id);
        if (!game) return;

        socket.emit('proceed-to-guess');
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        // Remove from waiting queue
        gameState.waitingQueue = gameState.waitingQueue.filter(id => id !== socket.id);

        // Handle active game disconnection
        const game = findGameBySocketId(socket.id);
        if (game && game.active) {
            const otherPlayer = game.detective.id === socket.id ? game.responder : game.detective;
            if (!game.isAI) {
                io.to(otherPlayer.id).emit('opponent-disconnected');
            }
            gameState.activeGames.delete(game.id);
        }

        gameState.userSockets.delete(socket.id);
    });

    // Get leaderboard
    socket.on('get-leaderboard', () => {
        socket.emit('leaderboard-data', gameState.leaderboard);
    });
});

// Matching algorithm
function matchPlayer(socket) {
    const user = gameState.userSockets.get(socket.id);

    // Emit matching started event
    socket.emit('matching-started');

    // Check if there's someone waiting
    if (gameState.waitingQueue.length > 0) {
        // Random choice: human or bot when humans are available
        const chooseHuman = Math.random() > 0.5;
        
        if (chooseHuman) {
            // Match with human
            const opponentId = gameState.waitingQueue.shift();
            const opponent = gameState.userSockets.get(opponentId);

            if (opponent && io.sockets.sockets.get(opponentId)) {
                createHumanGame(socket, io.sockets.sockets.get(opponentId));
            } else {
                // Opponent disconnected, try again
                matchPlayer(socket);
            }
        } else {
            // Choose bot instead
            createAIGame(socket);
        }
    } else {
        // No humans waiting, so always get a bot
        // Add to waiting queue first to maintain consistent delay
        gameState.waitingQueue.push(socket.id);
        
        // Set timeout to create AI game after consistent delay
        setTimeout(() => {
            if (gameState.waitingQueue.includes(socket.id)) {
                gameState.waitingQueue = gameState.waitingQueue.filter(id => id !== socket.id);
                createAIGame(socket);
            }
        }, 3000); // 3 second delay to match human matching experience
    }
}

// Create game with human opponent
function createHumanGame(socket1, socket2) {
    const gameId = crypto.randomBytes(16).toString('hex');

    // Randomly assign roles
    const isSocket1Detective = Math.random() > 0.5;
    const detective = isSocket1Detective ?
        gameState.userSockets.get(socket1.id) :
        gameState.userSockets.get(socket2.id);
    const responder = isSocket1Detective ?
        gameState.userSockets.get(socket2.id) :
        gameState.userSockets.get(socket1.id);

    const game = new GameSession(gameId, detective, responder, false);
    gameState.activeGames.set(gameId, game);

    // Notify both players
    io.to(detective.id).emit('game-started', {
        role: 'detective',
        opponent: 'human',
        gameId: gameId
    });

    io.to(responder.id).emit('game-started', {
        role: 'responder',
        opponent: 'human',
        gameId: gameId
    });

    // Set game timer
    setTimeout(() => {
        if (game.active) {
            io.to(detective.id).emit('time-up');
            io.to(responder.id).emit('time-up');
        }
    }, game.duration);
}

// Create game with AI bot
function createAIGame(socket) {
    const gameId = crypto.randomBytes(16).toString('hex');
    const user = gameState.userSockets.get(socket.id);

    const bot = new AIBot();
    const aiPersonality = bot.selectPersonality();

    const aiPlayer = {
        id: 'ai_' + gameId,
        username: 'AI_Bot',
        isAI: true
    };

    const game = new GameSession(gameId, user, aiPlayer, true);
    game.aiPersonality = aiPersonality;
    gameState.activeGames.set(gameId, game);

    socket.emit('game-started', {
        role: 'detective',
        opponent: 'unknown', // Don't reveal it's AI
        gameId: gameId
    });

    // Send initial AI message
    setTimeout(async () => {
        const greeting = await bot.generateResponse("", []);
        game.addMessage('responder', greeting);
        socket.emit('receive-message', {
            message: greeting,
            sender: 'opponent'
        });
    }, 2000);

    // Set game timer
    setTimeout(() => {
        if (game.active) {
            socket.emit('time-up');
        }
    }, game.duration);
}

// Helper function to find game by socket ID
function findGameBySocketId(socketId) {
    for (const [gameId, game] of gameState.activeGames) {
        if (game.detective.id === socketId || game.responder.id === socketId) {
            return game;
        }
    }
    return null;
}

// Update leaderboard
function updateLeaderboard(user) {
    const entry = {
        username: user.username,
        score: user.score.correct,
        total: user.score.total,
        accuracy: user.score.total > 0 ?
            Math.round((user.score.correct / user.score.total) * 100) : 0
    };

    // Remove old entry if exists
    gameState.leaderboard = gameState.leaderboard.filter(e => e.username !== user.username);

    // Add new entry
    gameState.leaderboard.push(entry);

    // Sort by score
    gameState.leaderboard.sort((a, b) => {
        if (b.score === a.score) {
            return b.accuracy - a.accuracy;
        }
        return b.score - a.score;
    });

    // Keep top 100
    gameState.leaderboard = gameState.leaderboard.slice(0, 100);

    // Broadcast leaderboard update
    io.emit('leaderboard-updated', gameState.leaderboard.slice(0, 10));
}

// REST API endpoints
app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', activeGames: gameState.activeGames.size });
});

app.get('/api/leaderboard', (req, res) => {
    res.json(gameState.leaderboard.slice(0, 20));
});

app.get('/api/stats', (req, res) => {
    res.json({
        totalGames: gameState.userScores.size,
        activeGames: gameState.activeGames.size,
        waitingPlayers: gameState.waitingQueue.length
    });
});

// AI Chat endpoint for single-player mode
app.post('/api/chat', async (req, res) => {
    try {
        const { message, conversationHistory = [] } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Check if OpenAI API key is available
        if (!process.env.OPENAI_API_KEY) {
            console.error('OpenAI API key not found');
            return res.status(500).json({ error: 'AI service not configured' });
        }

        // Prepare conversation context
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

        // Call OpenAI API
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: messages,
            max_tokens: 150,
            temperature: 0.8
        });

        const response = completion.choices[0].message.content;
        
        res.json({ response: response });
    } catch (error) {
        console.error('AI API error:', error);
        res.status(500).json({ error: 'Failed to generate AI response' });
    }
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`AmIaBot server running on port ${PORT}`);
    console.log('Environment:', process.env.NODE_ENV || 'development');
});