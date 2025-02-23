export interface ProcessResult {
    learnings: string[];
    visitedUrls: string[];
    content?: string;
    sources?: string[];
    methodology?: string;
    limitations?: string;
    citations?: any[];
}
export interface ResearchProgress {
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
interface ResearchResult {
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
}
export declare function conductResearch(query: string, depth?: number): Promise<ResearchResult>;
export {};
//# sourceMappingURL=deep-research.d.ts.map