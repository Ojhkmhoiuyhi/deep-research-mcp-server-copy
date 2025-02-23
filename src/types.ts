export interface ResearchResult {
  learnings: string[];
  visitedUrls: string[];
}

export interface MCPResearchResult {
  content: { type: "text"; text: string }[];
  metadata: {
    learnings: string[];
    visitedUrls: string[];
    stats: {
      totalLearnings: number;
      totalSources: number;
    };
  };
} 