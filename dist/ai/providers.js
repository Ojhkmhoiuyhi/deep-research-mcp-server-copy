import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { z } from 'zod';
import { RecursiveCharacterTextSplitter } from './text-splitter.js';
import { cosineSimilarity } from "ai";
const average = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
// Initialize with proper environment validation
const validateEnv = () => {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('Missing GEMINI_API_KEY in environment variables');
    }
    return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
};
const googleAI = validateEnv();
// Model configuration with type safety
const ModelConfigSchema = z.object({
    model: z.string(),
    generationConfig: z.object({
        temperature: z.number().min(0).max(1).optional(),
        topP: z.number().min(0).max(1).optional(),
    }).optional(),
    safetySettings: z.array(z.object({
        category: z.nativeEnum(HarmCategory),
        threshold: z.nativeEnum(HarmBlockThreshold)
    })).optional(),
});
const getModel = (config) => {
    ModelConfigSchema.parse(config);
    return googleAI.getGenerativeModel(config);
};
// Configure models with proper types
export const embeddingModel = googleAI.getGenerativeModel({
    model: "text-embedding-004" // Official Gemini embedding model
});
export const flashModel = googleAI.getGenerativeModel({
    model: "gemini-2.0-flash", // Fast model for token operations
    generationConfig: { temperature: 0.2 }
});
export const researchModel = getModel({
    model: "gemini-2.0-flash",
    generationConfig: { temperature: 0.2, topP: 0.95 },
    safetySettings: [{
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
        }]
});
// Models
const genAIModel = googleAI.getGenerativeModel({ model: "gemini-2.0-pro-exp-02-05" });
const genAIModel2 = googleAI.getGenerativeModel({ model: "gemini-2.0-flash" });
const genAIModel3 = googleAI.getGenerativeModel({ model: "gemini-2.0-flash-thinking-exp-01-21" });
const genAIModel4 = googleAI.getGenerativeModel({ model: "text-embedding-004" }); // Specify embedding model - embedding-001 is the latest recommended
export const o3MiniModel = genAIModel;
export const o3MiniModel2 = genAIModel2;
export const o3MiniModel3 = genAIModel3;
export const o3MiniModel4 = genAIModel4;
const MinChunkSize = 140; // TODO: Consider making this configurable or a named constant in a config file
// Update trimPrompt to use flashModel directly
export async function trimPrompt(prompt, maxTokens) {
    if (!prompt)
        return '';
    // Use flashModel for token counting
    const countTokensResponse = await flashModel.countTokens({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    const tokenLength = countTokensResponse.totalTokens;
    if (tokenLength <= maxTokens)
        return prompt;
    const overflowTokens = tokenLength - maxTokens;
    const chunkSize = prompt.length - Math.floor(overflowTokens * 3);
    if (chunkSize < MinChunkSize) { // Minimum chunk size to prevent overly aggressive trimming
        return prompt.slice(0, MinChunkSize);
    }
    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize,
        chunkOverlap: 0,
    });
    const trimmedPrompt = splitter.splitText(prompt)[0] ?? '';
    if (trimmedPrompt.length === prompt.length) {
        return trimPrompt(prompt.slice(0, chunkSize), maxTokens);
    }
    return trimPrompt(trimmedPrompt, maxTokens);
}
// Function for managing prompts
export function createPrompt(template, variables) {
    let prompt = template;
    for (const key in variables) {
        prompt = prompt.replace(`{{${key}}}`, variables[key] ?? '');
    }
    return prompt;
}
/**
 * Generates a text embedding using the Gemini API 'text-embedding-004' model.
 *
 * @param text The input text to generate an embedding for.
 * @returns A Promise that resolves to a Float32Array representing the embedding,
 *          or null if there was an error.
 */
export async function generateTextEmbedding(text) {
    try {
        const embeddingModel = googleAI.getGenerativeModel({ model: "text-embedding-004" }); // Specify embedding model - embedding-001 is the latest recommended
        const result = await embeddingModel.embedContent(text);
        const embedding = result.embedding?.values;
        if (!embedding) {
            console.error("Gemini API: No embedding returned in the response.");
            return null;
        }
        return embedding; // Explicitly cast to number[]
    }
    catch (error) {
        console.error("Gemini API - Error generating text embedding:", error);
        return null;
    }
}
export async function callGeminiProConfigurable(prompt, modelName = "gemini-2.0-flash", temperature, safetySettings) {
    const model = googleAI.getGenerativeModel({ model: modelName });
    // Trim the prompt before sending it to the model
    const trimmedPrompt = await trimPrompt(prompt, 8192); // Assuming maxTokens is 8192, adjust if needed
    try {
        const response = await model.generateContent(trimmedPrompt); // Use trimmedPrompt here
        return response.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    }
    catch (error) {
        console.error("GeminiPro API Error:", error);
        return "";
    }
}
// Update semantic chunking to handle null embeddings
export async function semanticChunking(text, model = "text-embedding-004") {
    const embedding = await generateTextEmbedding(text);
    if (!embedding) {
        // Fallback to recursive splitter if embedding fails
        const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000 });
        return splitter.splitText(text);
    }
    const semanticBoundaries = detectSemanticShifts(embedding);
    return splitTextBySemanticBoundaries(text, semanticBoundaries, embedding);
}
function detectSemanticShifts(embedding, windowSize = 5) {
    const boundaries = [];
    for (let i = windowSize; i < embedding.length - windowSize; i++) {
        const prevAvg = average(embedding.slice(i - windowSize, i));
        const nextAvg = average(embedding.slice(i, i + windowSize));
        if (Math.abs(prevAvg - nextAvg) > 0.3)
            boundaries.push(i);
    }
    return boundaries;
}
function splitTextBySemanticBoundaries(text, boundaries, embedding) {
    const charsPerToken = text.length / embedding.length;
    return boundaries.map(b => text.substring(Math.floor((b - 1) * charsPerToken), Math.floor(b * charsPerToken)));
}
export async function adaptivePrompt(basePrompt, context, similarityThreshold = 0.85) {
    const baseEmbedding = await generateTextEmbedding(basePrompt);
    const contextEmbeddings = await Promise.all(context.map(generateTextEmbedding));
    const relevantContext = context.filter((_, i) => baseEmbedding && contextEmbeddings[i] &&
        cosineSimilarity(baseEmbedding, contextEmbeddings[i]) > similarityThreshold);
    return `${basePrompt}\n\nRelevant Context:\n${relevantContext.join("\n")}`;
}
// Add null handling in text splitter integration
export class SemanticTextSplitter {
    async splitText(text) {
        try {
            const embedding = await embeddingModel.embedContent(text); // Uses text-embedding-004
            const vector = embedding.embedding?.values;
            if (!vector)
                throw Error('No embedding vector');
            return this.calculateSemanticChunks(text, vector);
        }
        catch (error) {
            console.error('Semantic split failed:', error);
            const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000 });
            return splitter.splitText(text);
        }
    }
    calculateSemanticChunks(text, vector) {
        const charsPerToken = text.length / vector.length;
        const chunkSize = Math.floor(vector.length * 0.2); // Adjust chunk size based on vector
        return Array.from({ length: Math.ceil(text.length / chunkSize) }, (_, i) => text.substring(i * chunkSize, (i + 1) * chunkSize));
    }
}
