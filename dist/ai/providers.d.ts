import { type GenerativeModel } from "@google/generative-ai";
export declare const embeddingModel: GenerativeModel;
export declare const flashModel: GenerativeModel;
export declare const researchModel: GenerativeModel;
export declare const o3MiniModel: GenerativeModel;
export declare const o3MiniModel2: GenerativeModel;
export declare const o3MiniModel3: GenerativeModel;
export declare const o3MiniModel4: GenerativeModel;
export declare function trimPrompt(prompt: string, maxTokens: number): Promise<string>;
export declare function createPrompt(template: string, variables: Record<string, string>): string;
/**
 * Generates a text embedding using the Gemini API 'text-embedding-004' model.
 *
 * @param text The input text to generate an embedding for.
 * @returns A Promise that resolves to a Float32Array representing the embedding,
 *          or null if there was an error.
 */
export declare function generateTextEmbedding(text: string): Promise<number[] | null>;
export declare function callGeminiProConfigurable(prompt: string, modelName?: string, temperature?: number, safetySettings?: any): Promise<string>;
export type ResearchResultOutput = {
    content: string;
    sources: string[];
    methodology: string;
    limitations: string;
    citations: Array<{
        source: string;
        context: string;
    }>;
    learnings: string[];
    visitedUrls: string[];
};
export interface TextSplitter {
    splitText(text: string): Promise<string[]>;
    chunkSize: number;
}
export declare function semanticChunking(text: string, splitter?: TextSplitter): Promise<string[]>;
export declare function adaptivePrompt(basePrompt: string, context: string[], similarityThreshold?: number): Promise<string>;
export declare class SemanticTextSplitter {
    splitText(text: string): Promise<string[]>;
    private calculateSemanticChunks;
}
//# sourceMappingURL=providers.d.ts.map