import { GoogleGenAI } from "@google/genai";
import { LRUCache } from 'lru-cache';
import { RecursiveCharacterTextSplitter, SemanticTextSplitter as SemanticSplitter } from './text-splitter.js';
import { cosineSimilarity } from 'ai';

// Environment and client setup
function clampNumber(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) {
    return min;
  }
  return Math.max(min, Math.min(max, n));
}

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  throw new Error('Missing GEMINI_API_KEY in environment variables');
}

const client = new GoogleGenAI({
  apiKey: API_KEY,
  ...(process.env.GEMINI_API_ENDPOINT ? { apiEndpoint: process.env.GEMINI_API_ENDPOINT } : {}),
});

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MAX_TOKENS = clampNumber(parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS || '65536', 10), 1024, 65000);
const TEMPERATURE = parseFloat(process.env.GEMINI_TEMPERATURE || '0.4');
const TOP_P = parseFloat(process.env.GEMINI_TOP_P || '0.9');
const TOP_K = clampNumber(parseInt(process.env.GEMINI_TOP_K || '40', 10), 1, 1000);
const CANDIDATE_COUNT = clampNumber(parseInt(process.env.GEMINI_CANDIDATE_COUNT || '2', 10), 1, 8);
const THINKING_BUDGET_TOKENS = clampNumber(parseInt(process.env.THINKING_BUDGET_TOKENS || '1500', 10), 0, 8000);
const ENABLE_URL_CONTEXT = (process.env.ENABLE_URL_CONTEXT || 'true').toLowerCase() === 'true';
const ENABLE_GEMINI_GOOGLE_SEARCH = (process.env.ENABLE_GEMINI_GOOGLE_SEARCH || 'true').toLowerCase() === 'true';
const ENABLE_GEMINI_CODE_EXECUTION = (process.env.ENABLE_GEMINI_CODE_EXECUTION || 'false').toLowerCase() === 'true';
const ENABLE_GEMINI_FUNCTIONS = (process.env.ENABLE_GEMINI_FUNCTIONS || 'false').toLowerCase() === 'true';
const ENABLE_PROVIDER_CACHE = (process.env.ENABLE_PROVIDER_CACHE || 'true').toLowerCase() === 'true';
const PROVIDER_CACHE_MAX = clampNumber(parseInt(process.env.PROVIDER_CACHE_MAX || '100', 10), 10, 5000);

// Convenience alias
const ai = client;

// Embeddings model and helper
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004';
export async function generateTextEmbedding(text: string): Promise<number[]> {
  const res = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: [{ role: 'user', parts: [{ text }] }],
  });
  return (res.embeddings?.[0]?.values ?? []) as number[];
}

// Shared generation config (optionally enforce JSON via responseMimeType)
type GenExtra = Partial<{ responseMimeType: string; responseSchema: any; tools: any[] }>;
function baseConfig(extra?: GenExtra) {
  return {
    temperature: TEMPERATURE,
    maxOutputTokens: MAX_TOKENS,
    candidateCount: CANDIDATE_COUNT,
    topP: TOP_P,
    topK: TOP_K,
    ...(extra?.responseMimeType ? { responseMimeType: extra.responseMimeType } : {}),
    ...(extra?.responseSchema ? { responseSchema: extra.responseSchema } : {}),
  };
}

// Input type kept compatible with the project
type ContentArg = string | { contents: Array<{ role: string; parts: Array<{ text?: string }> }> };

// Provider-level cache (optional)
const providerCache = ENABLE_PROVIDER_CACHE
  ? new LRUCache<string, any>({ max: PROVIDER_CACHE_MAX })
  : null;

// Default tool set based on env flags; merged with any extra.tools at call time
function defaultTools(): any[] {
  const tools: any[] = [];
  if (ENABLE_GEMINI_GOOGLE_SEARCH) {
    tools.push({ googleSearch: {} });
  }
  if (ENABLE_GEMINI_CODE_EXECUTION) {
    tools.push({ codeExecution: {} });
  }
  // Functions require explicit declarations from caller; gate by flag but do not add empty set
  return tools;
}

// Core generator: normalize ContentArg and call model.generateContent
async function generateContentInternal(prompt: ContentArg, extra?: GenExtra) {
  const contents =
    typeof prompt === 'string'
      ? [{ role: 'user', parts: [{ text: prompt }] }]
      : prompt.contents;

  const toolsCombined = [
    ...defaultTools(),
    ...(ENABLE_GEMINI_FUNCTIONS ? (extra?.tools || []) : []),
  ];

  // Cache key includes model, contents, config basics, and tools signature
  const cacheKey = providerCache
    ? JSON.stringify({ m: MODEL, c: contents, g: baseConfig(extra), t: toolsCombined })
    : '';
  if (providerCache && providerCache.has(cacheKey)) {
    return providerCache.get(cacheKey);
  }

  const request: any = {
    model: MODEL,
    contents,
    config: baseConfig(extra),
  };
  if (toolsCombined.length > 0) {
    request.tools = toolsCombined;
  }

  const raw = await ai.models.generateContent(request);

  // Back-compat shim: expose response.text() like older code expects
  const extractText = (r: any): string => {
    const parts = r.candidates?.[0]?.content?.parts;
    const firstText = parts?.find((p: any) => typeof p.text === 'string')?.text;
    return firstText ?? '';
  };
  const textVal = extractText(raw);
  const wrapped = Object.assign({}, raw, {
    response: {
      text: async () => textVal,
    },
  });
  if (providerCache) {
    providerCache.set(cacheKey, wrapped);
  }
  return wrapped;
}

// Maintain expected exports
export const o3MiniModel = {
  generateContent: (prompt: ContentArg) => generateContentInternal(prompt),
};

export const o3MiniModel2 = {
  generateContent: (prompt: ContentArg) => generateContentInternal(prompt),
};

export const researchModel = {
  generateContent: (prompt: ContentArg) => generateContentInternal(prompt),
};

// Token counting via model.countTokens
export async function countTokens(contents: Array<{ role: string; parts: Array<{ text?: string }> }>) {
  const res = await ai.models.countTokens({ model: MODEL, contents });
  return (res.totalTokens as number) ?? 0;
}

// Trims a prompt based on token count
export async function trimPrompt(prompt: string, maxTokens: number) {
  if (!prompt) {
    return '';
  }
  const contents = [{ role: 'user', parts: [{ text: prompt }] }];
  const tokenLength = await countTokens(contents);

  if (tokenLength <= maxTokens) {
    return prompt;
  }

  // simple resize by characters proportional to overflow
  const overflowTokens = tokenLength - maxTokens;
  const approxCharsPerToken = Math.max(2, Math.floor(prompt.length / Math.max(1, tokenLength)));
  const sliceLen = Math.max(140, prompt.length - overflowTokens * approxCharsPerToken);
  return prompt.slice(0, sliceLen);
}

// Function for managing prompts
export function createPrompt(template: string, variables: Record<string, string>): string {
  let prompt = template;
  for (const key in variables) {
    prompt = prompt.replace(`{{${key}}}`, variables[key] ?? '');
  }
  return prompt;
}

// Configurable text call; returns string. Adds JSON response MIME when requested.
export async function callGeminiProConfigurable(
  prompt: string,
  opts?: { json?: boolean; schema?: object }
): Promise<string> {
  const contents = [{ role: 'user', parts: [{ text: prompt }] }];
  const raw = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: baseConfig(
      opts?.json
        ? { responseMimeType: 'application/json', ...(opts?.schema ? { responseSchema: opts.schema } : {}) }
        : undefined
    ),
  });
  const parts = (raw as any).candidates?.[0]?.content?.parts;
  return parts?.find((p: any) => typeof p.text === 'string')?.text ?? '';
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

// Text splitter utilities retained
const TextProcessingConfig = {
  MIN_CHUNK_SIZE: 140,
  MAX_CHUNK_SIZE: 8192,
  CHUNK_OVERLAP: 20,
} as const;

const splitter = new SemanticSplitter({
  chunkSize: TextProcessingConfig.MIN_CHUNK_SIZE,
  chunkOverlap: TextProcessingConfig.CHUNK_OVERLAP,
});

const getChunkSize = () =>
  process.env.CHUNK_SIZE ? Number(process.env.CHUNK_SIZE) : TextProcessingConfig.MIN_CHUNK_SIZE;

export interface TextSplitter {
  splitText(text: string): Promise<string[]>;
  chunkSize: number;
}

export async function semanticChunking(text: string, splitterOpt?: TextSplitter) {
  const effectiveSplitter = splitterOpt || new RecursiveCharacterTextSplitter();
  try {
    return await effectiveSplitter.splitText(text);
  } catch (error) {
    console.error('Chunking error:', error);
    return [text];
  }
}

// Note: Embeddings are intentionally NOT exported from providers.ts.
// Any embedding generation remains in src/ai/text-splitter.ts.

// Adaptive prompt utilities (kept, depends on external embedding logic)
export async function adaptivePrompt(
  basePrompt: string,
  context: string[],
  similarityThreshold = 0.8
) {
  // Compute embeddings locally using the embeddings helper above
  const baseEmbedding = await generateTextEmbedding(basePrompt);
  const contextEmbeddings = await Promise.all(context.map(txt => generateTextEmbedding(txt)));
  const relevantContext = context.filter(
    (_ , i) =>
      baseEmbedding &&
      contextEmbeddings[i] &&
      cosineSimilarity(baseEmbedding, contextEmbeddings[i]) > similarityThreshold
  );
  return `${basePrompt}\n\nRelevant Context:\n${relevantContext.join('\n')}`;
}

// Helper to extract text from GenerateContentResponse consistently
export function extractText(raw: any): string {
  const parts = raw?.candidates?.[0]?.content?.parts;
  return parts?.find((p: any) => typeof p.text === 'string')?.text ?? '';
}

// Convenience helper to call with explicit tools (e.g., function calling)
export async function generateWithTools(prompt: ContentArg, tools: any[], extra?: Omit<GenExtra, 'tools'>) {
  return generateContentInternal(prompt, { ...(extra || {}), tools });
}

// Simple citation extractor for URLs and bracketed references
export function extractCitations(text: string): { urls: string[]; refs: string[] } {
  if (!text) {
    return { urls: [], refs: [] };
  }
  const urlRegex = /(https?:\/\/[^\s)]+)(?=[)\s]|$)/g;
  const refRegex = /\[\[(\d+)\]\]/g;
  const urls = Array.from(new Set(
    Array.from(text.matchAll(urlRegex))
      .map(m => m[1])
      .filter((u): u is string => typeof u === 'string')
  ));
  const refs = Array.from(new Set(Array.from(text.matchAll(refRegex)).map(m => m[0])));
  return { urls, refs };
}

// Simple concurrency pool (no external deps)
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T, idx: number) => Promise<any>) {
  const results = new Array(items.length);
  let inFlight = 0;
  let index = 0;
  return await new Promise<any[]>((resolve, reject) => {
    const next = () => {
      if (index >= items.length && inFlight === 0) {
        return resolve(results);
      }
      while (inFlight < limit && index < items.length) {
        const i = index++;
        inFlight++;
        const item = items[i]!;
        Promise.resolve(worker(item, i))
          .then((res) => { results[i] = res; })
          .catch(reject)
          .finally(() => { inFlight--; next(); });
      }
    };
    next();
  });
}

// Batch generation using existing config/tools/caching
export async function generateBatch(prompts: ContentArg[], extra?: GenExtra, concurrency = clampNumber(parseInt(process.env.CONCURRENCY_LIMIT || '5', 10), 1, 64)) {
  return runWithConcurrency(prompts, concurrency, (p) => generateContentInternal(p, extra));
}

// Batch with explicit tools support (e.g., function calling)
export async function generateBatchWithTools(prompts: ContentArg[], tools: any[], extra?: Omit<GenExtra, 'tools'>, concurrency = clampNumber(parseInt(process.env.CONCURRENCY_LIMIT || '5', 10), 1, 64)) {
  return runWithConcurrency(prompts, concurrency, (p) => generateContentInternal(p, { ...(extra || {}), tools }));
}

// Structured helpers for analysis → final pipeline with optional URL grounding
export async function generateAnalysisPlan(
  userPrompt: string,
  context: string[],
  urlContext?: { url: string; snippet: string }[],
  schema: object = {
    type: 'object',
    properties: {
      plan: { type: 'array', items: { type: 'string' } },
      risks: { type: 'array', items: { type: 'string' } },
      missingInfo: { type: 'array', items: { type: 'string' } }
    },
    required: ['plan'],
    additionalProperties: false,
  }
): Promise<string> {
  const urlBlock = ENABLE_URL_CONTEXT && urlContext?.length
    ? `\n\nURL Context:\n${urlContext.map(u => `- ${u.url}: ${u.snippet}`).join('\n')}`
    : '';
  const prompt = `You are a precise research strategist. Produce a concise JSON plan for answering the user query.\n` +
    `User Query:\n${userPrompt}\n\nContext:\n${context.join('\n')}\n${urlBlock}\n\n` +
    `Constraints: Use at most ${THINKING_BUDGET_TOKENS} tokens for analysis. Do not include the final answer.`;
  return await callGeminiProConfigurable(prompt, { json: true, schema });
}

export async function generateFinalFromPlan(
  planJson: string,
  context: string[],
  urlContext?: { url: string; snippet: string }[],
  schema: object = {
    type: 'object',
    properties: {
      sections: { type: 'array', items: { type: 'string' } },
      citations: { type: 'array', items: { type: 'string' } }
    },
    required: ['sections'],
    additionalProperties: false,
  }
): Promise<string> {
  const urlBlock = ENABLE_URL_CONTEXT && urlContext?.length
    ? `\n\nURL Context:\n${urlContext.map(u => `- ${u.url}: ${u.snippet}`).join('\n')}`
    : '';
  const prompt = `Using the provided JSON plan, write the final structured output as JSON (sections and citations).\n` +
    `Plan JSON:\n${planJson}\n\nContext:\n${context.join('\n')}\n${urlBlock}`;
  return await callGeminiProConfigurable(prompt, { json: true, schema });
}
