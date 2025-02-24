import { GoogleGenerativeAI, type GenerativeModel, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { z } from 'zod';

import { 
  RecursiveCharacterTextSplitter, 
  SemanticTextSplitter as SemanticSplitter 
} from './text-splitter.js';
import { cosineSimilarity } from "ai";

const average = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

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
  model: z.literal("gemini-2.0-flash"), // Enforce specific model version
  generationConfig: z.object({
    temperature: z.number().min(0).max(1).default(0.2),
    topP: z.number().min(0).max(1).default(0.95),
    topK: z.number().min(1).max(40).default(32), // Add missing parameter
    maxOutputTokens: z.number().min(1).max(8192).default(8192)
  }),
  safetySettings: z.array(z.object({
    category: z.nativeEnum(HarmCategory),
    threshold: z.nativeEnum(HarmBlockThreshold).default(HarmBlockThreshold.BLOCK_LOW_AND_ABOVE)
  })).default([
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE
    },
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, 
      threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE
    }
  ])
});

type ModelConfig = z.infer<typeof ModelConfigSchema>;

const getModel = (config: ModelConfig): GenerativeModel => {
  ModelConfigSchema.parse(config);
  return googleAI.getGenerativeModel(config);
};

// Complete safety settings override
const disabledSafety = Object.values(HarmCategory).map(category => ({
  category,
  threshold: HarmBlockThreshold.BLOCK_NONE
}));

// Configure models with proper types
export const embeddingModel = googleAI.getGenerativeModel({
  model: "text-embedding-004",
  taskType: "RETRIEVAL_DOCUMENT", // @ts-ignore - Special embedding param
  dimensions: 768,
  safetySettings: disabledSafety
} as any); // Temporary workaround for SDK type limitations

export const flashModel = getModel({
  model: "gemini-2.0-flash",
  generationConfig: {
    temperature: 0.2,
    topP: 0.95,
    topK: 32,
    maxOutputTokens: 8192
  },
  safetySettings: disabledSafety
});

export const researchModel = getModel({
  model: "gemini-2.0-flash",
  generationConfig: { temperature: 0.2, topP: 0.95, topK: 32, maxOutputTokens: 8192 },
  safetySettings: disabledSafety
});

// Models
const genAIModel = googleAI.getGenerativeModel({
  model: "gemini-2.0-flash-thinking-exp-01-21",
  generationConfig: {
    temperature: 0.2,
    topP: 0.95,
    topK: 32,
    maxOutputTokens: 8192
  },
  safetySettings: disabledSafety
});

const genAIModel2 = googleAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  generationConfig: {
    temperature: 0.2,
    topP: 0.95,
    topK: 32,
    maxOutputTokens: 8192
  },
  safetySettings: disabledSafety
});

const genAIModel3 = googleAI.getGenerativeModel({
  model: "gemini-2.0-flash-thinking-exp-01-21",
  generationConfig: {
    temperature: 0.2,
    topP: 0.95,
    topK: 32,
    maxOutputTokens: 8192
  },
  safetySettings: disabledSafety
});

const genAIModel4 = googleAI.getGenerativeModel({
  model: "text-embedding-004",
  taskType: "RETRIEVAL_DOCUMENT", // @ts-ignore
  dimensions: 768
} as any);

export const o3MiniModel = genAIModel;
export const o3MiniModel2 = genAIModel2;
export const o3MiniModel3 = genAIModel3;
export const o3MiniModel4 = genAIModel4;

// Create a configuration object for chunk settings
const TextProcessingConfig = {
  MIN_CHUNK_SIZE: 140,
  MAX_CHUNK_SIZE: 8192,
  CHUNK_OVERLAP: 20
} as const;

// Update splitter usage
const splitter = new SemanticSplitter({
  chunkSize: TextProcessingConfig.MIN_CHUNK_SIZE,
  chunkOverlap: TextProcessingConfig.CHUNK_OVERLAP
});

// Make configurable via environment
const getChunkSize = () => 
  process.env.CHUNK_SIZE ? 
    Number(process.env.CHUNK_SIZE) : 
    TextProcessingConfig.MIN_CHUNK_SIZE;

// Update trimPrompt to use flashModel directly
export async function trimPrompt(prompt: string, maxTokens: number) {
  if (!prompt) return '';
  
  // Use flashModel for token counting
  const countTokensResponse = await flashModel.countTokens({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });
  
  const tokenLength = countTokensResponse.totalTokens;
  if (tokenLength <= maxTokens) return prompt;

  const overflowTokens = tokenLength - maxTokens;
  const chunkSize = prompt.length - Math.floor(overflowTokens * 3);
  
  if (chunkSize < getChunkSize()) { // Minimum chunk size to prevent overly aggressive trimming
    return prompt.slice(0, getChunkSize());
  }

  const trimmedPrompt = (await splitter.splitText(prompt))[0] ?? '';

  if (trimmedPrompt.length === prompt.length) {
    return trimPrompt(prompt.slice(0, chunkSize), maxTokens);
  }

  return trimPrompt(trimmedPrompt, maxTokens);
}

// Function for managing prompts
export function createPrompt(template: string, variables: Record<string, string>): string {
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

// Add type export to align with deep-research.ts
export type ResearchResultOutput = {
  content: string;
  sources: string[];
  methodology: string;
  limitations: string;
  citations: Array<{ source: string; context: string }>;
  learnings: string[];
  visitedUrls: string[];
};

// Add explicit interface for splitter compatibility
export interface TextSplitter {
  splitText(text: string): Promise<string[]>;
  chunkSize: number;
}

// Update semanticChunking to use unified interface
export async function semanticChunking(text: string, splitter?: TextSplitter) {
  const effectiveSplitter = splitter || new RecursiveCharacterTextSplitter();
  try {
    return await effectiveSplitter.splitText(text);
  } catch (error) {
    console.error('Chunking error:', error);
    return [text]; // Fallback to original text
  }
}

function detectSemanticShifts(embedding: number[], windowSize = 5) {
  const boundaries = [];
  for (let i = windowSize; i < embedding.length - windowSize; i++) {
    const prevAvg = average(embedding.slice(i - windowSize, i));
    const nextAvg = average(embedding.slice(i, i + windowSize));
    if (Math.abs(prevAvg - nextAvg) > 0.3) boundaries.push(i);
  }
  return boundaries;
}

function splitTextBySemanticBoundaries(text: string, boundaries: number[], embedding: number[]) {
  const charsPerToken = text.length / embedding.length;
  return boundaries.map(b => 
    text.substring(Math.floor((b - 1) * charsPerToken), Math.floor(b * charsPerToken))
  );
}

export async function adaptivePrompt(
  basePrompt: string, 
  context: string[], 
  similarityThreshold = 0.85
) {
  const baseEmbedding = await generateTextEmbedding(basePrompt);
  const contextEmbeddings = await Promise.all(context.map(generateTextEmbedding));
  
  const relevantContext = context.filter((_, i) => 
    baseEmbedding && contextEmbeddings[i] &&
    cosineSimilarity(baseEmbedding, contextEmbeddings[i]) > similarityThreshold
  );

  return `${basePrompt}\n\nRelevant Context:\n${relevantContext.join("\n")}`;
}

// Add null handling in text splitter integration
export class SemanticTextSplitter {
  async splitText(text: string): Promise<string[]> {
    try {
      const embedding = await embeddingModel.embedContent(text); // Uses text-embedding-004
      const vector = embedding.embedding?.values;
      
      if (!vector) throw Error('No embedding vector');
      return this.calculateSemanticChunks(text, vector);
    } catch (error) {
      console.error('Semantic split failed:', error);
      const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000 });
      return splitter.splitText(text);
    }
  }

  private calculateSemanticChunks(text: string, vector: number[]): string[] {
    const charsPerToken = text.length / vector.length;
    const chunkSize = Math.floor(vector.length * 0.2); // Adjust chunk size based on vector
    return Array.from({ length: Math.ceil(text.length / chunkSize) }, (_, i) =>
      text.substring(i * chunkSize, (i + 1) * chunkSize)
    );
  }
}
