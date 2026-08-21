import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import OpenAI from "openai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

/* ================================================= */
/* MIDDLEWARE                                        */
/* ================================================= */
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

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
/* IMAGE ANALYSIS (Groq -> OpenRouter Fallback)      */
/* ================================================= */
async function analyzeImage(base64Image, mimeType, userPrompt) {
    // 1. First try Groq's Qwen model (Cheaper, native)
    try {
        console.log(`Trying Groq vision model: qwen/qwen3.6-27b`);
        const completion = await groq.chat.completions.create({
            model: "qwen/qwen3.6-27b",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: userPrompt },
                        { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
                    ]
                }
            ],
        });
        if (completion.choices && completion.choices[0]) {
            return completion.choices[0].message.content;
        }
    } catch (error) {
        console.log(`Groq vision model failed. Falling back to OpenRouter...`);
        console.log(error.message);
    }

    // 2. Fallback to OpenRouter
    const visionModels = [
        "meta-llama/llama-4-maverick",
        "google/gemma-3-27b-it",
        "qwen/qwen2.5-vl-72b-instruct",
        "mistralai/mistral-small-3.1-24b-instruct",
    ];

    for (const model of visionModels) {
        try {
            console.log(`Trying OpenRouter vision model: ${model}`);
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
            console.log(error.message);
        }
    }
    return `Image analysis failed.`;
}

/* ================================================= */
/* STATELESS CHAT ROUTE                              */
/* ================================================= */
app.post("/chat", upload.single("image"), async (req, res) => {
    try {
        // Parse messages from stringified JSON if sent via FormData
        let messages = [];
        try {
            messages = JSON.parse(req.body.messages || "[]");
        } catch (e) {
            return res.status(400).json({ error: "Invalid messages format" });
        }

        const requestedModel = req.body.model || "openai/gpt-oss-120b";
        const image = req.file;

        if (!messages || messages.length === 0) {
            return res.status(400).json({ error: "No messages provided" });
        }

        // Get the latest user message text for image analysis context
        const lastUserMessage = messages[messages.length - 1];
        const userText = lastUserMessage.role === 'user' ? lastUserMessage.content : "";

        if (image) {
            const base64Image = image.buffer.toString("base64");
            const imageAnalysis = await analyzeImage(
                base64Image,
                image.mimetype,
                `Analyze this image carefully.\nUser request:\n${userText}\nDescribe appearance, clothing, colors, environment, text, and important details.`
            );

            // We inject the image analysis as a temporary system message before sending to the main LLM
            messages.splice(messages.length - 1, 0, {
                role: "system",
                content: `IMAGE ANALYSIS for the latest user message:\n${imageAnalysis}\nUse this naturally in your response.`
            });
        }

        // Clean messages to remove frontend-specific properties like imageSrc
        const cleanMessages = messages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));

        // Generate response using main model
        const completion = await groq.chat.completions.create({
            model: requestedModel,
            messages: cleanMessages,
        });
        
        const finalReply = completion.choices[0].message.content;
        
        // Return only the reply, frontend will append it to its own history
        res.json({ reply: finalReply });

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
    console.log(`JK AI Stateless Server running on port ${PORT}`);
});