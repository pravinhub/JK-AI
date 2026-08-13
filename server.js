import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(process.cwd(), "conversations.json");

/* ================================================= */
/* MIDDLEWARE                                        */
/* ================================================= */
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* ================================================= */
/* DB UTILS                                          */
/* ================================================= */

const defaultSystemPrompt = `
You are JK AI, a smart multimodal AI assistant.
You remember previous conversations and uploaded images.
Be conversational, helpful, and concise.
`;

async function getDB() {
    try {
        const data = await fs.readFile(DB_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        // If file doesn't exist, return empty object
        return {};
    }
}

async function saveDB(data) {
    await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

function createNewConversation(systemPrompt = defaultSystemPrompt) {
    return {
        title: "New Conversation",
        createdAt: Date.now(),
        systemPrompt: systemPrompt,
        messages: [
            {
                role: "system",
                content: systemPrompt,
            }
        ]
    };
}

/* ================================================= */
/* FILE UPLOAD                                       */
/* ================================================= */
const upload = multer({
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error("Only image files are allowed"));
        }
    },
});

/* ================================================= */
/* GROQ CLIENT                                       */
/* ================================================= */
const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
});

/* ================================================= */
/* OPENROUTER IMAGE ANALYSIS                         */
/* ================================================= */
async function analyzeImage(base64Image, mimeType, userPrompt) {
    const visionModels = [
        "meta-llama/llama-4-maverick",
        "google/gemma-3-27b-it",
        "qwen/qwen2.5-vl-72b-instruct",
        "mistralai/mistral-small-3.1-24b-instruct",
    ];

    for (const model of visionModels) {
        try {
            console.log(`Trying vision model: ${model}`);
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "http://localhost:3000",
                    "X-Title": "JK AI",
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: userPrompt },
                                { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
                            ],
                        },
                    ],
                }),
            });
            const data = await response.json();
            if (data.choices && data.choices[0]) {
                return data.choices[0].message.content;
            }
        } catch (error) {
            console.log(`Model failed: ${model}`);
            console.log(error);
        }
    }
    return `Image analysis failed.`;
}

/* ================================================= */
/* CONVERSATION ENDPOINTS                            */
/* ================================================= */

// List all conversations
app.get("/api/conversations", async (req, res) => {
    try {
        const db = await getDB();
        const list = Object.keys(db).map(id => ({
            id,
            title: db[id].title,
            createdAt: db[id].createdAt
        })).sort((a, b) => b.createdAt - a.createdAt); // newest first
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get a specific conversation
app.get("/api/conversations/:id", async (req, res) => {
    try {
        const db = await getDB();
        const conv = db[req.params.id];
        if (!conv) {
            return res.status(404).json({ error: "Conversation not found" });
        }
        res.json(conv);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Create new conversation
app.post("/api/conversations", async (req, res) => {
    try {
        const db = await getDB();
        const id = crypto.randomUUID();
        const { systemPrompt } = req.body;
        db[id] = createNewConversation(systemPrompt || defaultSystemPrompt);
        await saveDB(db);
        res.json({ id, ...db[id] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Delete a conversation
app.delete("/api/conversations/:id", async (req, res) => {
    try {
        const db = await getDB();
        if (db[req.params.id]) {
            delete db[req.params.id];
            await saveDB(db);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/* ================================================= */
/* CHAT ROUTE                                        */
/* ================================================= */
app.post("/chat", upload.single("image"), async (req, res) => {
    try {
        const userMessage = req.body.message || "";
        const conversationId = req.body.conversationId;
        const requestedModel = req.body.model || "llama-3.3-70b-versatile";
        const image = req.file;

        if (!conversationId) {
            return res.status(400).json({ error: "Missing conversationId" });
        }

        const db = await getDB();
        let conv = db[conversationId];

        if (!conv) {
            // Auto create if missing
            conv = createNewConversation();
            db[conversationId] = conv;
        }

        // Generate title if it's "New Conversation" and we have a message
        if (conv.title === "New Conversation" && userMessage) {
            conv.title = userMessage.substring(0, 30) + (userMessage.length > 30 ? "..." : "");
        }

        if (image) {
            const base64Image = image.buffer.toString("base64");
            const imageAnalysis = await analyzeImage(
                base64Image,
                image.mimetype,
                `Analyze this image carefully.\nUser request:\n${userMessage}\nDescribe appearance, clothing, colors, environment, text, and important details.`
            );

            conv.messages.push({
                role: "user",
                content: `[Uploaded an image]\nQuestion: ${userMessage}`,
            });
            conv.messages.push({
                role: "system",
                content: `IMAGE ANALYSIS:\n${imageAnalysis}\nUse this naturally in responses.`,
            });
            
            // Generate final response using main model
            const completion = await groq.chat.completions.create({
                model: requestedModel,
                messages: [
                    ...conv.messages,
                    {
                        role: "user",
                        content: `Based on image analysis:\n${imageAnalysis}\nAnswer: ${userMessage}`
                    }
                ],
            });
            
            const finalReply = completion.choices[0].message.content;
            conv.messages.push({ role: "assistant", content: finalReply });

        } else {
            conv.messages.push({ role: "user", content: userMessage });
            const completion = await groq.chat.completions.create({
                model: requestedModel,
                messages: conv.messages,
            });
            const reply = completion.choices[0].message.content;
            conv.messages.push({ role: "assistant", content: reply });
        }

        // Keep last 30 messages to avoid context limit overflow
        if (conv.messages.length > 30) {
            conv.messages = [
                conv.messages[0], // Keep system prompt
                ...conv.messages.slice(-29)
            ];
        }

        await saveDB(db);
        
        // Return latest assistant message and title
        const lastMessage = conv.messages[conv.messages.length - 1].content;
        res.json({ reply: lastMessage, title: conv.title });

    } catch (error) {
        console.log("FULL ERROR:");
        console.log(error);
        res.status(500).json({ error: error.message || "Failed to process request" });
    }
});

/* ================================================= */
/* HOME ROUTE                                        */
/* ================================================= */
app.get("/", (req, res) => {
    res.sendFile(process.cwd() + "/public/index.html");
});

/* ================================================= */
/* ERROR HANDLER                                     */
/* ================================================= */
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({ error: "Image too large. Max size is 25MB." });
    }
    res.status(500).json({ error: error.message || "Something went wrong" });
});

/* ================================================= */
/* SERVER START                                      */
/* ================================================= */
app.listen(PORT, () => {
    console.log(`JK AI Server running on port ${PORT}`);
});