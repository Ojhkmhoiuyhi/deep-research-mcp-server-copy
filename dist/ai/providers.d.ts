export declare const o3MiniModel: import("@google/generative-ai").GenerativeModel;
export declare const o3MiniModel2: import("@google/generative-ai").GenerativeModel;
export declare const o3MiniModel3: import("@google/generative-ai").GenerativeModel;
export declare function trimPrompt(prompt: string, maxTokens: number): string;
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
//# sourceMappingURL=providers.d.ts.map