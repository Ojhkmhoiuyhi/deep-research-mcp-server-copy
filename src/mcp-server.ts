import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { research, writeFinalReport, type ResearchProgress, ResearchOptions } from "./deep-research.js";
import { LRUCache } from 'lru-cache';
import { ZodError } from 'zod';

// Get the directory name of the current module
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') });

// Helper function to log to stderr
const log = (...args: any[]) => {
  process.stderr.write(`${args.map(arg => 
    typeof arg === 'string' ? arg : JSON.stringify(arg)
  ).join(' ')}\n`);
};

// Log environment variables for debugging (excluding sensitive values)
log('Environment check:', {
  hasOpenAiKey: !!process.env.GEMINI_API_KEY,
  hasFirecrawlKey: !!process.env.FIRECRAWL_API_KEY
});

// Change the interface name in mcp-server.ts to avoid conflict
interface MCPResearchResult {
    content: { type: "text"; text: string; }[];
    metadata: {
        learnings: string[];
        visitedUrls: string[];
        stats: {
            totalLearnings: number;
            totalSources: number;
        };
    };
    [key: string]: any;
}

// Update cache definition
const deepResearchCache = new LRUCache<string, MCPResearchResult>({
  max: 20,
});

const server = new McpServer({
  name: "deep-research",
  version: "1.0.0"
});

// Define the deep research tool
server.tool(
  "deep-research",
  "Perform deep research on a topic using AI-powered web search",
  {
    query: z.string().min(1).describe("The research query to investigate"),
    depth: z.number().min(1).max(5).describe("How deep to go in the research tree (1-5)"),
    breadth: z.number().min(1).max(5).describe("How broad to make each research level (1-5)"),
    existingLearnings: z.array(z.string()).optional().describe("Optional array of existing research findings to build upon")
  },
  async ({ query, depth, breadth, existingLearnings = [] }): Promise<MCPResearchResult | { content: { type: "text"; text: string; }[]; isError: boolean; }> => {
    // 1. Create cache key
    let cacheKey: string;
    try {
      const keyObject: any = { query, depth, breadth, existingLearnings };
      cacheKey = JSON.stringify(keyObject);
    } catch (keyError) {
      log("Error creating cache key:", keyError);
      return { content: [{ type: "text", text: "Error creating cache key" }], isError: true }; // Return an error response
    }

    // 2. Check cache
    try {
      const cachedResult = deepResearchCache.get(cacheKey);
      if (cachedResult) {
        log("Returning cached result for query:", query);
        return cachedResult;
      }
    } catch (cacheGetError) {
      log("Error getting result from cache:", cacheGetError);
      // Continue without cache if there's an error
    }

    try {
      log("Starting research with query:", query);
      const result = await research({
        query,
        depth: depth ?? 3,
        breadth: breadth ?? 3,
        existingLearnings: existingLearnings,
        onProgress: (progress: ResearchProgress) => {
          // Basic progress logging
          log(`Progress: ${progress.progressMsg}`);

          // Send progress notification with the text message
          // server.server.notification({ //NOTE: server.server is undefined - remove one `.server`
          //   method: "notifications/progress",
          //   params: {
          //     progressToken: 0,
          //     data: progressMsg
          //   }
          // })
          // .catch(error => {
          //   log("Error sending progress notification:", error);
          // });
        }
      } as ResearchOptions);

      log("Research completed, generating report...");

      // Generate final report
      const report = await writeFinalReport({
        prompt: query,
        learnings: result.learnings,
        visitedUrls: result.visitedUrls
      });

      log("Report generated successfully");

      const finalResult: MCPResearchResult = {
        content: [
          {
            type: "text",
            text: report
          }
        ],
        metadata: {
          learnings: result.learnings,
          visitedUrls: result.visitedUrls,
          stats: {
            totalLearnings: result.learnings.length,
            totalSources: result.visitedUrls.length
          }
        }
      };

      // 4. Store result in cache
      try {
        deepResearchCache.set(cacheKey, finalResult);
        log("Stored result in cache for query:", query);
      } catch (cacheSetError) {
        log("Error storing result in cache:", cacheSetError);
      }

      return finalResult;
    } catch (error) {
      log("Error in deep research:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("Error message:", errorMessage);

      return {
        content: [
          {
            type: "text",
            text: `Error during deep research: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }
);

// Start the MCP server
const transport = new StdioServerTransport(process.stdin, process.stdout);
server.connect(transport) // Pass the transport instance to server.connect()
  .then(() => {
    log("MCP server running");
  })
  .catch((err: Error) => { // Add type annotation to 'err'
    console.error("MCP server error:", err);
    log("MCP server error:", err);
  });
