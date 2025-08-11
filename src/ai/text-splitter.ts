import { Tiktoken, getEncoding, TiktokenEncoding } from "js-tiktoken";
import { generateTextEmbedding, countTokens as countModelTokens } from './providers.js';

export interface TextSplitterParams {
  chunkSize: number;
  chunkOverlap: number;
  modelName?: string;
  maxTokens?: number;
}

interface TiktokenTextSplitterParams extends TextSplitterParams {
  contextLength?: number;
}

// Update model configuration for Gemini embeddings
const modelConfig: { [modelName: string]: { maxTokens: number } } = {
  "text-embedding-004": { maxTokens: 3072 }, // Gemini text-embedding model
  "multimodal-embedding-001": { maxTokens: 2048 }, // Multimodal embedding
  // Default to latest Gemini embedding model
  "default": { maxTokens: 3072 }
};

abstract class TextSplitter implements TextSplitterParams {
  chunkSize = 1500;
  chunkOverlap = 200;
  modelName: string = "o200k_base";
  maxTokens: number; //  Remove default value
  protected abstract tokenizer: Tiktoken;  // Add abstract declaration

  constructor(fields?: Partial<TextSplitterParams>) {
    this.chunkSize = fields?.chunkSize ?? this.chunkSize;
    this.chunkOverlap = fields?.chunkOverlap ?? this.chunkOverlap;
    this.modelName = fields?.modelName ?? this.modelName;

    // Look up maxTokens from modelConfig, or use a default if not found
    this.maxTokens = modelConfig[this.modelName]?.maxTokens ?? 8192; // Default to 8192 if model not in config

    if (this.chunkOverlap >= this.chunkSize) {
      throw new Error('Cannot have chunkOverlap >= chunkSize');
    }
  }

  abstract splitText(text: string): Promise<string[]>;

  async createDocuments(texts: string[]): Promise<string[]> {
    const documents: string[] = [];
    for (const text of texts) {
      if (text != null) {
        for (const chunk of await this.splitText(text)) {
          documents.push(chunk);
        }
      }
    }
    return documents;
  }

  async splitDocuments(documents: string[]): Promise<string[]> {
    return this.createDocuments(documents);
  }

  private joinDocs(docs: string[], separator: string): string | null {
    const text = docs.join(separator).trim();
    return text === '' ? null : text;
  }

  // Update mergeSplits to use async token counting
  async mergeSplits(splits: string[], separator: string): Promise<string[]> {
    const docs: string[] = [];
    let currentDoc: string[] = [];
    let total = 0;

    for (const d of splits) {
      const _len = await this.getTokenCount(d);

      if (total + _len >= this.chunkSize) {
        if (currentDoc.length > 0) {
          const joined = this.joinDocs(currentDoc, separator);
          if (joined) {
            docs.push(joined);
          }
          currentDoc = [];
          total = 0;
        }
        // Handle current document
        if (_len > this.chunkSize) {
          continue; // Or implement chunk splitting logic
        }
      }

      currentDoc.push(d);
      total += _len;
    }

    // Final document
    if (currentDoc.length > 0) {
      const finalJoined = this.joinDocs(currentDoc, separator);
      if (finalJoined) {
        docs.push(finalJoined);
      }
    }

    return docs;
  }

  abstract getTokenCount(text: string): Promise<number>;
}

export interface RecursiveCharacterTextSplitterParams
  extends TextSplitterParams {
  separators: string[];
}

export class RecursiveCharacterTextSplitter
  extends TextSplitter
  implements RecursiveCharacterTextSplitterParams
{
  separators: string[] = ["\n\n", "\n", " ", ""];
  protected tokenizer = {
    encode: (text: string) => Array.from(new TextEncoder().encode(text)),
    decode: (tokens: number[]) => new TextDecoder().decode(Uint8Array.from(tokens))
  } as unknown as Tiktoken;

  constructor(fields?: Partial<TextSplitterParams> & { separators?: string[] }) {
    super(fields);
    this.separators = fields?.separators ?? this.separators;
  }

  async splitText(text: string): Promise<string[]> {
    const splits: string[] = [];
    let currentText = text;

    for (const separator of this.separators) {
      const split = currentText.split(separator);
      const newSplits: string[] = [];

      for (const s of split) {
        if (s.length > this.chunkSize) {
          const recursiveSplits = await this.splitText(s);
          newSplits.push(...recursiveSplits);
        } else {
          newSplits.push(s);
        }
      }

      currentText = newSplits.join(separator); 
    }

    if (currentText.length > 0) {
      splits.push(currentText);
    }

    return splits;
  }

  async getTokenCount(text: string): Promise<number> {
    try {
      return await countModelTokens([{ role: 'user', parts: [{ text }] }]);
    } catch (error) {
      console.error('Gemini token count failed, using fallback:', error);
      return text.split(/\s+/).length;
    }
  }
}

export class TiktokenTextSplitter extends TextSplitter {
  protected tokenizer: Tiktoken;

  constructor(fields?: Partial<TiktokenTextSplitterParams>) {
    super(fields);
    const encName = (this.modelName as TiktokenEncoding) || ("o200k_base" as TiktokenEncoding);
    try {
      this.tokenizer = getEncoding(encName);
    } catch {
      this.tokenizer = {
        encode: (text: string) => Array.from(new TextEncoder().encode(text)),
        decode: (tokens: number[]) => new TextDecoder().decode(Uint8Array.from(tokens)),
        free: () => {}
      } as unknown as Tiktoken;
    }
  }

  async getTokenCount(text: string): Promise<number> {
    try {
      return await countModelTokens([{ role: 'user', parts: [{ text }] }]);
    } catch (error) {
      console.error('Gemini token count failed, using fallback:', error);
      return text.split(/\s+/).length;
    }
  }

  async splitText(text: string): Promise<string[]> {
    const encoded = this.tokenizer.encode(text);
    const chunks: number[][] = [];
    let currentChunk: number[] = [];
    let currentChunkLength = 0;

    for (const token of encoded) {
      currentChunk.push(token);
      currentChunkLength++;

      if (currentChunkLength >= this.chunkSize) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentChunkLength = 0;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    const finalChunks: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const chunkLength = chunk.length;
      const startIndex = Math.max(0, i * (this.chunkSize - this.chunkOverlap));
      const endIndex = Math.min(
        encoded.length,
        startIndex + chunkLength + this.chunkOverlap
      );
      const chunkWithOverlap = encoded.slice(startIndex, endIndex);
      finalChunks.push(this.tokenizer.decode(chunkWithOverlap));
    }

    return finalChunks;
  }
}

export class SemanticTextSplitter extends TextSplitter {
  constructor({ chunkSize = 2500, chunkOverlap = 500 }: {
    chunkSize?: number;
    chunkOverlap?: number;
  } = {}) {
    super({ chunkSize, chunkOverlap });
  }

  async splitText(text: string): Promise<string[]> {
    const vector = await generateTextEmbedding(text);
    
    return this.calculateSemanticChunks(text, vector);
  }

  private calculateSemanticChunks(text: string, vector: number[]): string[] {
    const chunkLength = Math.floor(text.length / (vector.length / this.chunkSize));
    const chunks: string[] = [];
    
    for (let i = 0; i < text.length; i += chunkLength - this.chunkOverlap) {
      const end = Math.min(i + chunkLength, text.length);
      chunks.push(text.substring(i, end));
    }
    
    return chunks;
  }

  async getTokenCount(text: string): Promise<number> {
    try {
      return await countModelTokens([{ role: 'user', parts: [{ text }] }]);
    } catch {
      return text.split(/\s+/).length; 
    }
  }

  protected tokenizer = {
    encode: (text: string) => {
      const parts = text.trim().length ? text.split(/\s+/) : [];
      return parts.map((t) => t.length);
    },
    decode: (tokens: number[]) => {
      return tokens.map((n) => 'x'.repeat(Math.max(1, n))).join(' ');
    }
  };
}

