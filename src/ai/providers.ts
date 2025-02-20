import { GoogleGenerativeAI } from "@google/generative-ai";
import { getEncoding } from 'js-tiktoken';

import { RecursiveCharacterTextSplitter } from './text-splitter.js';

// Providers
// biome-ignore lint/style/noNonNullAssertion: <explanation>
const googleAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Models
const genAIModel = googleAI.getGenerativeModel({ model: "gemini-2.0-pro-exp-02-05" });

export const o3MiniModel = genAIModel;

const MinChunkSize = 140;
const encoder = getEncoding('o200k_base');

// trim prompt to maximum context size
export function trimPrompt(
  prompt: string,
  contextSize = Number(process.env.CONTEXT_SIZE) || 2_000_000,
) {
  if (!prompt) {
    return '';
  }

  const length = encoder.encode(prompt).length;
  if (length <= contextSize) {
    return prompt;
  }

  const overflowTokens = length - contextSize;
  // on average it's 3 characters per token, so multiply by 3 to get a rough estimate of the number of characters
  const chunkSize = prompt.length - overflowTokens * 3;
  if (chunkSize < MinChunkSize) {
    return prompt.slice(0, MinChunkSize);
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: 0,
  });
  const trimmedPrompt = splitter.splitText(prompt)[0] ?? '';

  // last catch, there's a chance that the trimmed prompt is same length as the original prompt, due to how tokens are split & innerworkings of the splitter, handle this case by just doing a hard cut
  if (trimmedPrompt.length === prompt.length) {
    return trimPrompt(prompt.slice(0, chunkSize), contextSize);
  }

  // recursively trim until the prompt is within the context size
  return trimPrompt(trimmedPrompt, contextSize);
}

// Example: Function for managing prompts
function createPrompt(template: string, variables: Record<string, string>): string {
  let prompt = template;
  for (const key in variables) {
    prompt = prompt.replace(`{{${key}}}`, variables[key] ?? '');
  }
  return prompt;
}
