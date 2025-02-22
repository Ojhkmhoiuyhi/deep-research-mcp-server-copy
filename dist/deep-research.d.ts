export type ResearchProgress = {
    currentDepth: number;
    totalDepth: number;
    currentBreadth: number;
    totalBreadth: number;
    currentQuery?: string;
    totalQueries: number;
    completedQueries: number;
    progressMsg?: string;
};
export interface researchProgress {
    progressMsg: string;
}
type ResearchResult = {
    learnings: string[];
    visitedUrls: string[];
};
interface WriteFinalReportParams {
    prompt: string;
    learnings: string[];
    visitedUrls: string[];
}
export declare function writeFinalReport({ prompt, learnings, visitedUrls, }: WriteFinalReportParams): Promise<string>;
export declare function research({ query, depth, breadth, existingLearnings, onProgress }: ResearchOptions): Promise<ResearchResult>;
export interface ResearchOptions {
    query: string;
    depth: number;
    breadth: number;
    existingLearnings?: string[];
    onProgress?: (progress: ResearchProgress) => void;
}
export {};
//# sourceMappingURL=deep-research.d.ts.map