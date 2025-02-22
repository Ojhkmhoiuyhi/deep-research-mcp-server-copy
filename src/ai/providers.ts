import { GoogleGenerativeAI } from "@google/generative-ai";
import { getEncoding } from 'js-tiktoken';

import { RecursiveCharacterTextSplitter } from './text-splitter.js';
import { TiktokenTextSplitter } from './text-splitter.js';

// Providers
// biome-ignore lint/style/noNonNullAssertion: <explanation>
const googleAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

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
const encoder = googleAI.getGenerativeModel({ model: "gemini-2.0-flash" });
// trim prompt to maximum context size
export async function trimPrompt(
  prompt: string,
  maxTokens: number,
) {
  let tokenLength: number = 0; // Declare tokenLength here
  if (!prompt) {
    return '';
  } else {
    try {
      const countTokensResponse = await encoder.countTokens({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      tokenLength = countTokensResponse.totalTokens;
      if (tokenLength <= maxTokens) {
        return prompt;
      }
    } catch (error) {
      console.error("Error counting tokens:", error);
      return prompt; // Return original prompt in case of error to avoid breaking functionality
    }
  }

  const overflowTokens = tokenLength - maxTokens;
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
export function createPrompt(template: string, variables: Record<string, string>): string { // Added type hints for parameters
  let prompt = template;
  for (const key in variables) {
    prompt = prompt.replace(`{{${key}}}`, variables[key] ?? '');
  }
  return prompt;
}

const splitter = new TiktokenTextSplitter({
  modelName: "o200k_base",
  maxTokens: 8192,
  chunkSize: 700,
  chunkOverlap: 150,
});

const myPrompt = "Your very long prompt here...";
const trimmedPrompt = trimPrompt(myPrompt, splitter.maxTokens);

// Now use the trimmedPrompt with your language model
callGeminiProConfigurable(await trimmedPrompt, "gemini-2.0-flash"); // Example usage

/**
 * Generates a text embedding using the Gemini API 'text-embedding-004' model.
 *
 * @param text The input text to generate an embedding for.
 * @returns A Promise that resolves to a Float32Array representing the embedding,
 *          or null if there was an error.
 */
export async function generateTextEmbedding(text: string): Promise<number[] | null> {
  try {
    const embeddingModel = googleAI.getGenerativeModel({ model: "text-embedding-004" }); // Specify embedding model - embedding-001 is the latest recommended
    const result = await embeddingModel.embedContent(text);
    const embedding = result.embedding?.values;

    if (!embedding) {
      console.error("Gemini API: No embedding returned in the response.");
      return null;
    }

    return embedding as number[]; // Explicitly cast to number[]
  } catch (error: any) {
    console.error("Gemini API - Error generating text embedding:", error);
    return null;
  }
}

export async function callGeminiProConfigurable(prompt: string, modelName: string = "gemini-2.0-flash", temperature?: number, safetySettings?: any): Promise<string> {
  const model = googleAI.getGenerativeModel({ model: modelName });

  // Trim the prompt before sending it to the model
  const trimmedPrompt = await trimPrompt(prompt, 8192); // Assuming maxTokens is 8192, adjust if needed

  try {
    const response = await model.generateContent(trimmedPrompt); // Use trimmedPrompt here
    return response.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  } catch (error) {
    console.error("GeminiPro API Error:", error);
    return "";
  }
}
