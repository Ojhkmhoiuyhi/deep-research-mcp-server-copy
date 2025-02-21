interface TextSplitterParams {
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
    constructor(fields?: Partial<TextSplitterParams>);
    abstract splitText(text: string): string[];
    createDocuments(texts: string[]): string[];
    splitDocuments(documents: string[]): string[];
    private joinDocs;
    mergeSplits(splits: string[], separator: string): string[];
}
export interface RecursiveCharacterTextSplitterParams extends TextSplitterParams {
    separators: string[];
}
export declare class RecursiveCharacterTextSplitter extends TextSplitter implements RecursiveCharacterTextSplitterParams {
    separators: string[];
    constructor(fields?: Partial<TextSplitterParams> & {
        separators?: string[];
    });
    splitText(text: string): string[];
}
export declare class TiktokenTextSplitter extends TextSplitter {
    private tokenizer;
    private contextLength;
    constructor(fields?: Partial<TiktokenTextSplitterParams>);
    splitText(text: string): string[];
}
export {};
//# sourceMappingURL=text-splitter.d.ts.map