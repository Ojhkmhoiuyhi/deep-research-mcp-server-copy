import { Tiktoken } from "js-tiktoken";
export interface TextSplitterParams {
    chunkSize: number;
    chunkOverlap: number;
    modelName?: string;
    maxTokens?: number;
}
interface TiktokenTextSplitterParams extends TextSplitterParams {
    contextLength?: number;
}
declare abstract class TextSplitter implements TextSplitterParams {
    chunkSize: number;
    chunkOverlap: number;
    modelName: string;
    maxTokens: number;
    protected abstract tokenizer: Tiktoken;
    constructor(fields?: Partial<TextSplitterParams>);
    abstract splitText(text: string): string[];
    createDocuments(texts: string[]): string[];
    splitDocuments(documents: string[]): string[];
    private joinDocs;
    mergeSplits(splits: string[], separator: string): Promise<string[]>;
    getTokenCount(text: string): Promise<number>;
}
export interface RecursiveCharacterTextSplitterParams extends TextSplitterParams {
    separators: string[];
}
export declare class RecursiveCharacterTextSplitter extends TextSplitter implements RecursiveCharacterTextSplitterParams {
    separators: string[];
    protected tokenizer: {
        encode: (text: string) => never[];
        decode: (tokens: number[]) => string;
    };
    constructor(fields?: Partial<TextSplitterParams> & {
        separators?: string[];
    });
    splitText(text: string): string[];
    getTokenCount(text: string): Promise<number>;
}
export declare class TiktokenTextSplitter extends TextSplitter {
    protected tokenizer: {
        encode: (text: string) => never[];
        decode: (tokens: number[]) => string;
    };
    constructor(fields?: Partial<TiktokenTextSplitterParams>);
    getTokenCount(text: string): Promise<number>;
    splitText(text: string): string[];
}
export declare class SemanticTextSplitter {
    private readonly chunkSize;
    private readonly chunkOverlap;
    constructor({ chunkSize, chunkOverlap }?: {
        chunkSize?: number;
        chunkOverlap?: number;
    });
    splitText(text: string): Promise<string[]>;
    private calculateSemanticChunks;
}
export {};
//# sourceMappingURL=text-splitter.d.ts.map