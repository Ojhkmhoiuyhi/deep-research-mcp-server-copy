export type ResearchProgress = {
    currentDepth: number;
    totalDepth: number;
    currentBreadth: number;
    totalBreadth: number;
    currentQuery?: string;
    totalQueries: number;
    completedQueries: number;
};
interface WriteFinalReportParams {
    prompt: string;
    learnings: string[];
    visitedUrls: string[];
}
export declare function writeFinalReport({ prompt, learnings, visitedUrls, }: WriteFinalReportParams): Promise<string>;
export declare function research({ query, breadth, depth, onProgress }: {
    query: string;
    breadth: number;
    depth: number;
    onProgress?: (progress: ResearchProgress) => void;
}): Promise<{
    learnings: string[];
    visitedUrls: string[];
}>;
export {};
//# sourceMappingURL=deep-research.d.ts.map