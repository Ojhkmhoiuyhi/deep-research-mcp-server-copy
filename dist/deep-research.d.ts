export interface ResearchResult {
    content: string;
    sources: string[];
    methodology: string;
    limitations: string;
    citations: any[];
    learnings: string[];
    visitedUrls: string[];
    firecrawlResults: SearchResponse;
    analysis: string;
}
export interface ProcessResult {
    analysis: string;
    content: string;
    sources: string[];
    methodology: string;
    limitations: string;
    citations: string[];
    learnings: string[];
    visitedUrls: string[];
    firecrawlResults: SearchResponse;
}
export interface ResearchProgress {
    [key: string]: unknown;
    currentQuery?: string;
    currentDepth: number;
    totalDepth: number;
    currentBreadth: number;
    totalBreadth: number;
    totalQueries: number;
    completedQueries: number;
    progressMsg?: string;
}
export interface researchProgress {
    progressMsg: string;
}
interface WriteFinalReportParams {
    prompt: string;
    learnings: string[];
    visitedUrls: string[];
}
export declare function writeFinalReport({ prompt, learnings, visitedUrls, }: WriteFinalReportParams): Promise<string>;
export declare function research(options: ResearchOptions): Promise<ResearchResult>;
export interface ResearchOptions {
    query: string;
    depth: number;
    breadth: number;
    existingLearnings?: string[];
    onProgress?: (progress: ResearchProgress) => void;
}
export declare function validateAcademicInput(input: string): boolean;
export declare function validateAcademicOutput(text: string): boolean;
export declare function conductResearch(query: string, depth?: number): Promise<ResearchResult>;
interface FirecrawlResult {
    url?: string;
}
interface SearchResponse {
    data: FirecrawlResult[];
    metadata: {
        success: boolean;
        error: string;
    };
}
export {};
//# sourceMappingURL=deep-research.d.ts.map