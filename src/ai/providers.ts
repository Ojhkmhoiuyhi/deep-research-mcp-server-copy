import { GoogleGenerativeAI } from "@google/generative-ai";
import { getEncoding } from 'js-tiktoken';

import { RecursiveCharacterTextSplitter } from './text-splitter.js';
import { TiktokenTextSplitter } from './text-splitter.js';

// Providers
// biome-ignore lint/style/noNonNullAssertion: <explanation>
const googleAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Models
const genAIModel = googleAI.getGenerativeModel({ model: "gemini-2.0-pro-exp-02-05" });
const genAIModel2 = googleAI.getGenerativeModel({ model: "	gemini-2.0-flash" });
const genAIModel3 = googleAI.getGenerativeModel({ model: "gemini-2.0-flash-thinking-exp-01-21" });

export const o3MiniModel = genAIModel;
export const o3MiniModel2 = genAIModel2;
export const o3MiniModel3 = genAIModel3;

const MinChunkSize = 140;
const encoder = getEncoding('o200k_base');

// trim prompt to maximum context size
export function trimPrompt(
  prompt: string,
  maxTokens: number,
) {
  if (!prompt) {
    return '';
  }

  const length = encoder.encode(prompt).length;
  if (length <= maxTokens) {
    return prompt;
  }

  const overflowTokens = length - maxTokens;
  const chunkSize = prompt.length - Math.floor(overflowTokens * 3);
  if (chunkSize < MinChunkSize) {
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

// Example: Function for managing prompts
function createPrompt(template: string, variables: Record<string, string>): string {
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
