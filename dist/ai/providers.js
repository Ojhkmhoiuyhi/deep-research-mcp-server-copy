import { GoogleGenerativeAI } from "@google/generative-ai";
import { getEncoding } from 'js-tiktoken';
import { RecursiveCharacterTextSplitter } from './text-splitter.js';
import { TiktokenTextSplitter } from './text-splitter.js';
// Providers
// biome-ignore lint/style/noNonNullAssertion: <explanation>
const googleAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Models
const genAIModel = googleAI.getGenerativeModel({ model: "gemini-2.0-pro-exp-02-05" });
const genAIModel2 = googleAI.getGenerativeModel({ model: "	gemini-2.0-flash" });
const genAIModel3 = googleAI.getGenerativeModel({ model: "gemini-2.0-flash-thinking-exp-01-21" });
export const o3MiniModel = genAIModel;
export const o3MiniModel2 = genAIModel2;
export const o3MiniModel3 = genAIModel3;
const MinChunkSize = 140; // TODO: Consider making this configurable or a named constant in a config file
const encoder = getEncoding('o200k_base');
// trim prompt to maximum context size
export function trimPrompt(prompt, maxTokens) {
    if (!prompt) {
        return '';
    }
    const length = encoder.encode(prompt).length;
    if (length <= maxTokens) {
        return prompt;
    }
    const overflowTokens = length - maxTokens;
    const chunkSize = prompt.length - Math.floor(overflowTokens * 3); // Formula for chunk size - explain rationale?
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
const splitter = new TiktokenTextSplitter({
    modelName: "gemini-2.0-flash",
    maxTokens: 8192,
    chunkSize: 700,
    chunkOverlap: 150,
});
const myPrompt = "Your very long prompt here...";
const trimmedPrompt = trimPrompt(myPrompt, splitter.maxTokens);
// Now use the trimmedPrompt with your language model
/**
 * Generates a text embedding using the Gemini API 'text-embedding-004' model.
 *
 * @param text The input text to generate an embedding for.
 * @returns A Promise that resolves to a Float32Array representing the embedding,
 *          or null if there was an error.
 */
export async function generateTextEmbedding(text) {
    try {
        const embeddingModel = googleAI.getGenerativeModel({ model: "embedding-004" }); // Specify embedding model - embedding-001 is the latest recommended
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
export async function callGeminiProConfigurable(prompt, modelName = "gemini-pro", temperature, safetySettings) {
    const model = googleAI.getGenerativeModel({ model: modelName });
    // Trim the prompt before sending it to the model
    const trimmedPrompt = trimPrompt(prompt, 8192); // Assuming maxTokens is 8192, adjust if needed
    try {
        const response = await model.generateContent(trimmedPrompt); // Use trimmedPrompt here
        return response.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    }
    catch (error) {
        console.error("GeminiPro API Error:", error);
        return "";
    }
}
