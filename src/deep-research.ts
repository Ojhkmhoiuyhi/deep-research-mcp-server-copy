import { z } from 'zod';
import FirecrawlApp, { type SearchResponse as FirecrawlSearchResponse } from '@mendable/firecrawl-js';
import { LRUCache } from 'lru-cache';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import pkg, { result } from 'lodash';
const { escape } = pkg;

import { 
  type ResearchResultOutput,
  trimPrompt,
  o3MiniModel,
  o3MiniModel2,
  callGeminiProConfigurable,
  generateTextEmbedding 
} from './ai/providers.js';
import { systemPrompt, serpQueryPromptTemplate, learningPromptTemplate, generateGeminiPrompt } from './prompt.js';
import { RecursiveCharacterTextSplitter } from './ai/text-splitter.js';
import { error } from 'node:console';
import { extractJsonFromText, isValidJSON, safeParseJSON, stringifyJSON } from './utils/json.js';
import { OutputManager } from './output-manager.js';
import { sanitizeReportContent } from './utils/sanitize.js';
import { researchModel } from './ai/providers.js';
import { SemanticTextSplitter } from './ai/text-splitter.js';

const output = new OutputManager();


// Rename your local type to avoid conflict
export interface ResearchResult {
  content: string;
  sources: string[];
  methodology: string;
  limitations: string;
  citations: any[];
  learnings: string[];
  visitedUrls: string[];
  firecrawlResults: SearchResponse; // Use actual Firecrawl type
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
  [key: string]: unknown; // Add index signature
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

// Configuration from environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-pro"; // Default to gemini-pro
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const FIRECRAWL_BASE_URL = process.env.FIRECRAWL_BASE_URL;
const CONCURRENCY_LIMIT = parseInt(process.env.CONCURRENCY_LIMIT || "5", 10); // Default to 5

if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable is not set');
}

if (!FIRECRAWL_API_KEY) {
  output.log("Warning: FIRECRAWL_API_KEY environment variable is not set.  Firecrawl functionality will be limited.");
  // Consider throwing an error here instead, depending on your requirements
}

const firecrawl = new FirecrawlApp({
  apiKey: FIRECRAWL_API_KEY ?? '',
  apiUrl: FIRECRAWL_BASE_URL,
});

const ConcurrencyLimit = CONCURRENCY_LIMIT;

// take en user query, return a list of SERP queries
const SerpQuerySchema = z.object({
  query: z.string(),
  researchGoal: z.string(),
});

type SerpQuery = { query: string; researchGoal: string; };

const DEFAULT_NUM_QUERIES = 3;

// Create an LRU cache instance
const serpQueryCache = new LRUCache<string, SerpQuery[]>({
  max: 50, // Maximum number of items in the cache
});

// Create LRU cache for final reports
const reportCache = new LRUCache<string, { __returned: string; __abortController: AbortController; __staleWhileFetching: undefined }>({ // Cache stores report strings
  max: 20, // Adjust max size as needed
});

function logResearchProgress(progressData: ResearchProgress) {
  try {
    const prettyJson = JSON.stringify(progressData, null, 2);
    output.log("Progress:", JSON.parse(prettyJson)); // Parse before logging
  } catch (e) {
    output.log("Log error:", { error: e instanceof Error ? e.message: String(e) });
    output.log("Raw data:", { data: progressData });
  }
}

function cacheSearchResults(query: string, results: any) {
  const minifiedResultsJson = stringifyJSON(results); // Minified for efficient storage

  if (minifiedResultsJson) {
    // ... code to store minifiedResultsJson in your cache (e.g., LRUCache) ...
    output.log(`Cached results for query: "${query}" (JSON length: ${minifiedResultsJson.length})`);
  } else {
    output.log("Error stringifying search results for caching.");
    // Handle caching error
  }
}

async function generateSerpQueries({
  query: rawQuery,
  numQueries = DEFAULT_NUM_QUERIES,
  learnings = [],
  researchGoal = "Initial query",
  initialQuery,
  depth = 1,
  breadth = 1,
}: {
  query: string;
  numQueries?: number;
  learnings?: string[];
  researchGoal?: string;
  initialQuery?: string;
  depth?: number;
  breadth?: number;
}): Promise<SerpQuery[]> {
  try {
    // 1. Create a cache key
    let cacheKey: string;
    try {
      const keyObject: any = { rawQuery, numQueries, researchGoal, initialQuery, depth, breadth };

      // Omit default values from the cache key
      if (numQueries === DEFAULT_NUM_QUERIES) delete keyObject.numQueries;
      if (researchGoal === "Initial query") delete keyObject.researchGoal;
      if (initialQuery === rawQuery) delete keyObject.initialQuery; // Assuming initialQuery defaults to rawQuery
      if (depth === 1) delete keyObject.depth;
      if (breadth === 1) delete keyObject.breadth;

      // Hash the learnings array (example using a simple hash function)
      const learningsHash = learnings.length > 0 ? String(learnings.reduce((acc, val) => acc + val.charCodeAt(0), 0)) : '';
      keyObject.learningsHash = learningsHash;

      cacheKey = JSON.stringify(keyObject);
    } catch (e) {
      output.log("Error creating cache key:", { error: e instanceof Error ? e.message : 'Unknown error' });
      cacheKey = rawQuery; // Fallback to a simple key
    }

    // 2. Check if the result is in the cache
    try {
      const cachedResult = serpQueryCache.get(cacheKey);
      if (cachedResult) {
        output.log("Cache hit:", { key: cacheKey });
        return cachedResult;
      }
    } catch (e) {
      output.log("Cache error:", { error: e instanceof Error ? e.message : 'Unknown cache error' });
    }

    output.log(`Generating SERP queries for key: ${cacheKey}`);

    const query = escape(rawQuery);
    const sanitizedLearnings = learnings?.map(escape);

    const prompt = serpQueryPromptTemplate
      .replace('{{query}}', query)
      .replace('{{numQueries}}', String(numQueries))
      .replace('{{researchGoal}}', researchGoal || "General Research")
      .replace('{{initialQuery}}', initialQuery || rawQuery)
      .replace('{{depth}}', depth?.toString() || "1")
      .replace('{{breadth}}', breadth?.toString() || "1");

    let learningsString = '';
    if (Array.isArray(sanitizedLearnings) && sanitizedLearnings.length > 0) {
      learningsString = sanitizedLearnings.join('\n');
    }

    const finalPrompt = prompt.replace('{{learnings.join("\\n")}}', learningsString);

    output.log(`generateSerpQueries prompt: ${finalPrompt}`);

    let geminiResult: any;
    let jsonString: string = '{}';

    try {
      geminiResult = await o3MiniModel.generateContent(finalPrompt);
      output.log('Gemini response:', { response: JSON.parse(JSON.stringify(geminiResult)) });

      const geminiText = geminiResult.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (typeof geminiText === 'string') {
        jsonString = geminiText;
      } else {
        output.log("Error: Gemini response text is not a string or is missing.");
        jsonString = '{}';
      }
    } catch (error) {
      output.log("Gemini error:", { error: error instanceof Error ? error.message : 'Unknown error' });
      jsonString = '{}';
    }

    const rawQueriesJSON = extractJsonFromText(jsonString);
    let serpQueries: SerpQuery[] = [];

    if (rawQueriesJSON && Array.isArray(rawQueriesJSON)) {
      serpQueries = rawQueriesJSON.slice(0, numQueries)
        .map((rawQuery: any) => {
          const parsedQuery = SerpQuerySchema.safeParse({ // Use SerpQuerySchema to parse
            query: rawQuery?.query || rawQuery, // Handle cases where query is directly a string or in an object
            researchGoal: researchGoal, // Or get researchGoal from rawQuery if available
          });
          return parsedQuery.success ? parsedQuery.data as SerpQuery : null; // Return parsed data or null if parsing fails
        })
        .filter(Boolean) as SerpQuery[]; // Filter out null values from failed parses
    } else {
      output.log("Failed to generate or parse SERP queries from Gemini response, using fallback to empty array.");
      serpQueries = [];
    }

    // 4. Store the result in the cache
    try {
      serpQueryCache.set(cacheKey, serpQueries);
      output.log(`Cached SERP queries for key: ${cacheKey}`);
    } catch (e) {
      output.log("Error setting to cache:", { error: e instanceof Error ? e.message : 'Unknown error' });
    }

    return serpQueries;

  } catch (error) {
    output.log("Error in generateSerpQueries:", { error: error instanceof Error ? error.message : 'Unknown error' });
    return []; // Return an empty array in case of any error during query generation
  }
}

// Update splitter initialization to use provider configuration
const createResearchSplitter = () => {
  return new RecursiveCharacterTextSplitter({
    chunkSize: 140,
    chunkOverlap: 20,
    separators: ['\n\n', '\n', ' ']
  });
};

// Update processSerpResult to use provider-sanctioned splitter
async function processSerpResult({
  query,
  result,
  numLearnings = 3,
}: {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
}): Promise<{ learnings: string[]; followUpQuestions: string[]; }> {
  const contents = compact(result.data.map(item => 
    (item as any).markdown // Type assertion for compatibility
  ));
  const resolvedContents = await Promise.all(contents);

  const urls = compact(result.data.map(item => item.url));
  output.log(`Ran ${query}, found ${contents.length} contents and ${urls.length} URLs:`, { urls });

  // Use provider-approved text splitter
  const splitter = createResearchSplitter();
  let chunks: string[] = [];

  // Add proper error handling for splitter failures
  try {
    chunks = await splitter.splitText(resolvedContents.join("\n\n"));
  } catch (error) {
    output.log(`Text splitting failed: ${error}`);
    return { learnings: [], followUpQuestions: [] };
  }

  // Process each chunk with the LLM
  const learnings: string[] = [];

  for (const chunk of chunks) {
    const prompt = learningPromptTemplate
      .replace("{{query}}", query)
      .replace("{{title}}", (result.data[0] as any)?.title || "No Title")
      .replace("{{url}}", result.data[0]?.url || "No URL")
      .replace("{{content}}", chunk);

    const geminiResult = await (await o3MiniModel2.generateContent(prompt));

    const parsedResult = z.object({
      learnings: z.array(z.string()),
      followUpQuestions: z.array(z.string()),
    }).safeParse(JSON.parse(geminiResult.response.text()));

    if (parsedResult.success) {
      learnings.push(...(parsedResult.data.learnings ?? []));
    }
  }

  return { learnings: learnings.slice(0, numLearnings) ?? [], followUpQuestions: [] };
}

// Insert helper functions before writeFinalReport
// New helper function to generate an outline from the prompt and learnings
async function generateOutline(prompt: string, learnings: string[]): Promise<string> {
  try {
    const outlinePrompt = `${systemPrompt()}\n\nBased on the prompt and the following learnings, generate a detailed outline for a research report:\nPrompt: ${prompt}\nLearnings:\n${learnings.join("\\n")}`;
    const outlineResponse = await o3MiniModel.generateContent(outlinePrompt);
    const outlineText = await outlineResponse.response.text();
    return outlineText;
  } catch (error) {
    output.log('Error in generateOutline:', { error });
    return 'Outline could not be generated.';
  }
}

// New helper function to write a report from the generated outline and learnings
async function writeReportFromOutline(outline: string, learnings: string[]): Promise<string> {
  // Add sanitization step
  const cleanOutline = sanitizeReportContent(outline);
  const cleanLearnings = learnings.map(sanitizeReportContent);
  
  try {
    const reportPrompt = `${systemPrompt()}\n\nUsing the following outline and learnings, write a comprehensive research report.\nOutline:\n${cleanOutline}\nLearnings:\n${cleanLearnings.join("\\n")}`;
    const reportResponse = await o3MiniModel.generateContent(reportPrompt);
    const reportText = await reportResponse.response.text();
    return reportText;
  } catch (error) {
    output.log('Error in writeReportFromOutline:', { error });
    return 'Report could not be generated.';
  }
}

// New helper function to generate a summary from the learnings
async function generateSummary(learnings: string[]): Promise<string> {
  try {
    const summaryPrompt = `${systemPrompt()}\n\nGenerate a concise summary of the following learnings:\nLearnings:\n${learnings.join("\\n")}`;
    const summaryResponse = await o3MiniModel.generateContent(summaryPrompt);
    const summaryText = await summaryResponse.response.text();
    return summaryText;
  } catch (error) {
    output.log('Error in generateSummary:', { error });
    return 'Summary could not be generated.';
  }
}

// New helper function to generate a title from the prompt and learnings
async function generateTitle(prompt: string, learnings: string[]): Promise<string> {
  try {
    const titlePrompt = `${systemPrompt()}\n\nGenerate a concise and informative title for a research report based on the prompt and learnings:\nPrompt: ${prompt}\nLearnings:\n${learnings.join("\\n")}`;
    const titleResponse = await o3MiniModel.generateContent(titlePrompt);
    const titleText = await titleResponse.response.text();
    return titleText;
  } catch (error) {
    output.log('Error in generateTitle:', { error });
    return 'Title could not be generated.';
  }
}

interface DeepResearchOptions {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  visitedUrls?: string[];
  onProgress?: (progress: ResearchProgress) => void;
  reportProgress?: (progress: ResearchProgress) => void;
  initialQuery?: string;
  researchGoal?: string;
}

const DEFAULT_DEPTH = 2;
const DEFAULT_BREADTH = 5;

async function deepResearch({
  query,
  depth = DEFAULT_DEPTH,
  breadth = DEFAULT_BREADTH,
  learnings: initialLearnings = [],
  visitedUrls: initialVisitedUrls = [],
  onProgress,
  reportProgress = (progress: any) => {
    output.log('Research Progress:', progress);
  },
  initialQuery = query,
  researchGoal = "Deep dive research",
}: DeepResearchOptions): Promise<ResearchResult> {
  let visitedUrls = [...initialVisitedUrls];
  let learnings = [...initialLearnings];

  // Initialize progress object
  let progress: ResearchProgress = {
    currentDepth: depth,
    totalDepth: depth,
    currentBreadth: breadth,
    totalBreadth: breadth,
    totalQueries: breadth * depth,
    completedQueries: 0,
  };

  if (depth <= 0) {
    output.log("Reached research depth limit.");
    return { content: '', sources: [], methodology: '', limitations: '', citations: [], learnings: [], visitedUrls: [], firecrawlResults: { metadata: {} } as SearchResponse, analysis: '' };
  }

  if (visitedUrls.length > 20) {
    output.log("Reached visited URLs limit.");
    return { content: '', sources: [], methodology: '', limitations: '', citations: [], learnings: [], visitedUrls: [], firecrawlResults: { metadata: {} } as SearchResponse, analysis: '' };
  }

  const serpQueries = await generateSerpQueries({
    query,
    numQueries: breadth,
    learnings,
    researchGoal,
    initialQuery,
    depth,
    breadth,
  });

  const limit = pLimit(ConcurrencyLimit);

  const limitedProcessResult = async (serpQuery: SerpQuery): Promise<ProcessResult> => {
    let newLearnings: string[] = [];
    let newUrls: string[] = [];

    try {
      output.log(`Generating Gemini prompt for query: ${serpQuery.query}...`);
      const prompt = generateGeminiPrompt({ query: serpQuery.query, researchGoal: serpQuery.researchGoal, learnings });
      output.log("Gemini Prompt: " + prompt.substring(0, 200) + "..."); // Log first 200 chars of prompt
      const geminiResponseText = await callGeminiProConfigurable(prompt);

      const geminiResult = await processGeminiResponse(geminiResponseText);
      newLearnings = geminiResult.learnings;
      newUrls = geminiResult.urls;

      if (visitedUrls.includes(serpQuery.query)) {
        output.log(`Already visited URL for query: ${serpQuery.query}, skipping.`);
        return {
          analysis: '',
          content: '',
          sources: [],
          methodology: '',
          limitations: '',
          citations: [],
          learnings: [],
          visitedUrls: [],
          firecrawlResults: { metadata: {} } as SearchResponse
        }; // Return empty result to avoid affecting overall learnings
      }

      try {
        output.log(`Firecrawl scraping for query: ${serpQuery.query}...`);
        const result = await firecrawl.search(
          serpQuery.query,
          {
            timeout: 15000,
            limit: breadth,
            scrapeOptions: { formats: ['markdown'] },
          }
        );

        // Add type assertion to result to ensure TypeScript knows the structure
        const firecrawlResult = result as { data?: Array<{ url?: string }> };

        if (!firecrawlResult || !firecrawlResult.data) {
          output.log(`Invalid Firecrawl result for query: ${serpQuery.query}`);
          return {
            analysis: '',
            content: '',
            sources: [],
            methodology: '',
            limitations: '',
            citations: [],
            learnings: [],
            visitedUrls: [],
            firecrawlResults: { metadata: {} } as SearchResponse
          };
        }

        // Collect URLs from this search, using optional chaining for safety
        newUrls = compact(firecrawlResult.data.map(item => item.url));
        const newBreadth = Math.ceil(breadth / 2);
        const newDepth = depth - 1;

        output.log("Researching deeper...");
        const processResult = await processSerpResult({
          query: serpQuery.query,
          result: { ...result, metadata: { success: true, error: '' } } as SearchResponse,
          numLearnings: 3,
        });
        const newLearnings = processResult?.learnings ?? []; // Assign here to pre-declared variable
        const allLearnings = [...learnings, ...newLearnings];
        const allUrls = [...visitedUrls, ...newUrls];

        if (newDepth > 0) {
          output.log(
            `Researching deeper, breadth: ${newBreadth}, depth: ${newDepth}`,
          );

          progress = {
            currentDepth: newDepth,
            currentBreadth: newBreadth,
            completedQueries: progress.completedQueries + 1,
            currentQuery: serpQuery.query,
            totalDepth: progress.totalDepth,
            totalBreadth: progress.totalBreadth,
            totalQueries: progress.totalQueries,
          };

          if (onProgress) {
            onProgress(progress);
          }

          // Enhanced Query Refinement
          // const keywords = extractKeywords(query + " " + learnings.join(" ")); // Keyword extraction and query expansion functions are not defined in the provided code.
          // const refinedQuery = expandQuery(serpQuery.researchGoal, keywords);

          // const nextQuery = refinedQuery; // Using original query for now as refinement is not implemented
          const nextQuery = serpQuery.query; // Using original query for now as refinement is not implemented

          return deepResearch({
            query: nextQuery,
            breadth: newBreadth,
            depth: newDepth,
            learnings: allLearnings,
            visitedUrls: allUrls,
            onProgress,
            reportProgress,
            initialQuery,
            researchGoal,
          });
        } else {
          output.log("Reached maximum research depth.");
          return {
            analysis: geminiResult.analysis || 'No analysis available',
            content: newLearnings.join('\n\n'),
            sources: [],
            methodology: 'Semantic chunking with Gemini Flash 2.0',
            limitations: 'Current implementation focuses on text analysis only',
            citations: [],
            learnings: newLearnings,
            visitedUrls: newUrls,
            firecrawlResults: { metadata: { success: false, error: 'No metadata' }, ...result } as unknown as SearchResponse,
          };
        }
      } catch (error) {
        output.log(`Error processing query ${serpQuery.query}: ${error}`);
        return {
          analysis: '',
          content: '',
          sources: [],
          methodology: '',
          limitations: '',
          citations: [],
          learnings: [],
          visitedUrls: [],
          firecrawlResults: { metadata: {} } as SearchResponse
        };
      } finally {
        progress.completedQueries += 1; // Increment completed queries count
        if (reportProgress) {
          reportProgress(progress); // Report progress after each query
        }
      }
    } catch (error) {
      output.log(`Error processing query ${serpQuery.query}: ${error}`);
      return {
        analysis: '',
        content: '',
        sources: [],
        methodology: '',
        limitations: '',
        citations: [],
        learnings: [],
        visitedUrls: [],
        firecrawlResults: { metadata: {} } as SearchResponse
      };
    }
  };

  const promises = serpQueries.map((serpQuery) => limit(() => limitedProcessResult(serpQuery)));

  const results = await Promise.all(promises);

  visitedUrls = compact(results.flatMap((result: ProcessResult) => result?.visitedUrls));
  learnings = compact(results.flatMap((result: ProcessResult) => result?.learnings));

  const processedData = {
    analysis: '',
    content: learnings.join('\n\n'),
    sources: [],
    methodology: 'Semantic chunking with Gemini Flash 2.0',
    limitations: 'Current implementation focuses on text analysis only',
    citations: [],
    learnings: learnings,
    visitedUrls: visitedUrls,
    firecrawlResults: { metadata: {}, ...result } as SearchResponse,
  };

  // Process Firecrawl results into the report
  const firecrawlResponse = await firecrawl.search(query);
  
  return {
    ...processedData,
    firecrawlResults: { metadata: { success: false, error: 'No metadata' }, ...firecrawlResponse } as unknown as SearchResponse,
  };
}

interface WriteFinalReportParams {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
}

export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
}: WriteFinalReportParams): Promise<string> {
  // 1. Create cache key
  let cacheKey: string;
  try {
    const keyObject: any = { prompt };
    const learningsHash = learnings.length > 0 ? String(learnings.reduce((acc, val) => acc + val.charCodeAt(0), 0)) : ''; // Hash learnings
    keyObject.learningsHash = learningsHash;
    const visitedUrlsHash = visitedUrls.length > 0 ? String(visitedUrls.reduce((acc, val) => acc + val.charCodeAt(0), 0)) : ''; // Hash visitedUrls (optional)
    keyObject.visitedUrlsHash = visitedUrlsHash; // Include visitedUrls hash in key (optional)
    cacheKey = JSON.stringify(keyObject);
  } catch (keyError) {
    output.log("Error creating report cache key:", { error: keyError instanceof Error ? keyError.message : 'Unknown error' });
    cacheKey = 'default-report-key'; // Fallback key
  }

  // 2. Check cache
  try {
    const cachedReport = reportCache.get(cacheKey);
    if (cachedReport) {
      output.log(`Returning cached report for key: ${cacheKey}`);
      return cachedReport.__returned;
    }
  } catch (cacheGetError) {
    output.log("Error getting report from cache:", { error: cacheGetError instanceof Error ? cacheGetError.message : 'Unknown error' });
    // Continue without cache if error
  }

  output.log("Generating outline...");
  const outline = await generateOutline(prompt, learnings);
  output.log("Outline generated:", { outline });

  output.log("Writing report from outline...");
  const report = await writeReportFromOutline(outline, learnings);
  output.log("Report generated.");

  output.log("Generating summary...");
  const summary = await generateSummary(learnings);
  output.log("Summary generated.");

  output.log("Generating title...");
  const title = await generateTitle(prompt, learnings);
  output.log("Title generated:", { title });

  const finalReport = `
# ${title}

## Summary
${summary}

## Outline
${outline}

## Report
${report}

## Learnings
${learnings.map(learning => `- ${learning}`).join('\n')}

## Visited URLs
${visitedUrls.map(url => `- ${url}`).join('\n')}
`;

  const finalReportContent = await trimPrompt(finalReport, systemPrompt.length);

  output.log("Final Research Report:", { finalReportContent });

  // 3. Store report in cache
  try {
    reportCache.set(cacheKey, { 
      __returned: finalReportContent,
      __abortController: new AbortController(),
      __staleWhileFetching: undefined
    });
    output.log(`Cached report for key: ${cacheKey}`);
  } catch (cacheSetError) {
    output.log("Error setting report to cache:", { error: cacheSetError instanceof Error ? cacheSetError.message : 'Unknown error' });
  }

  output.saveResearchReport(finalReportContent);

  return finalReportContent;
}

export async function research(options: ResearchOptions): Promise<ResearchResult> {
  output.log(`Starting research for query: ${options.query}`);

  const researchResult = await deepResearch({
    query: options.query,
    depth: options.depth,
    breadth: options.breadth,
    learnings: options.existingLearnings || [],
    onProgress: options.onProgress,
  });
  output.log("Deep research completed. Generating final report...");

  const finalReport = await writeFinalReport({
    prompt: options.query,
    learnings: researchResult.learnings,
    visitedUrls: researchResult.visitedUrls,
  });
  output.log("Final report written. Research complete.");
  output.log(`Final Report: ${finalReport}`); // Log the final report

  return researchResult;
}

export interface ResearchOptions {
    query: string;
    depth: number;
    breadth: number;
    existingLearnings?: string[];
    onProgress?: (progress: ResearchProgress) => void;
}

async function someFunction() {
  const textToEmbed = "This is the text I want to embed.";
  const embedding = await generateTextEmbedding(textToEmbed);

  if (embedding) {
    output.log("Generated Embedding:", { embedding });
    // ... use the embedding for semantic search, clustering, etc. ...
  } else {
    output.log("Failed to generate text embedding.");
  }
}

interface GeminiResponse {
    items: any[]; // Assuming 'items' is always an array, adjust if needed
}

interface ProcessedGeminiResponse {
    analysis: string;
    learnings: string[];
    urls: string[];
    citations: { reference: string; context: string }[];
}

async function processGeminiResponse(geminiResponseText: string): Promise<ProcessedGeminiResponse> {
  const responseData = safeParseJSON<GeminiResponse>(geminiResponseText, { items: [] });

  let learnings: string[] = [];
  let urls: string[] = [];

  if (Array.isArray(responseData.items)) {
    responseData.items.forEach(item => {
      // Add strict filtering for final research content
      if (item?.learning && typeof item.learning === 'string' && 
          !item.learning.includes('INTERNAL PROCESS:') &&
          !item.learning.startsWith('OUTLINE:') &&
          !item.learning.match(/^Step \d+:/)) {
        learnings.push(item.learning.trim());
      }
      
      // Keep URL extraction as-is
      if (item?.url && typeof item.url === 'string') {
        urls.push(item.url.trim());
      }
    });
    
    // Add final sanitization before return
    learnings = learnings.map(l => l.replace(/\[.*?\]/g, '').trim()).filter(l => l.length > 0);
  }

  // Extract citations from response text
  const citationMatches = geminiResponseText.match(/\[\[\d+\]\]/g) || [];
  const citations = citationMatches.map(match => ({
    reference: match,
    context: geminiResponseText.split(match)[1]?.split('.')[0] || '' // Get first sentence after citation
  }));

  return {
    analysis: '',
    learnings: learnings.slice(0, 10),
    urls: Array.from(new Set(urls)),
    citations
  };
}

export function validateAcademicInput(input: string) {
  return input.length > 10 && input.split(/\s+/).length >= 3;
}

export function validateAcademicOutput(text: string) {
  const validationMetrics = {
    citationDensity: (text.match(/\[\[\d+\]\]/g) || []).length / (text.split(/\s+/).length / 100),
    recentSources: (text.match(/\[\[\d{4}\]\]/g) || []).filter(yr => parseInt(yr) > 2019).length,
    conflictDisclosures: text.includes("Conflict Disclosure:") ? 1 : 0
  };
  return validationMetrics.citationDensity > 1.5 && 
         validationMetrics.recentSources > 3 &&
         validationMetrics.conflictDisclosures === 1;
}

// Update conductResearch to use real sources
export async function conductResearch(
  query: string,
  depth: number = 3
): Promise<ResearchResult> {
  const splitter = new SemanticTextSplitter();
  const chunks = await splitter.splitText(query);
  
  const researchChain = chunks.map(async (chunk) => {
    const result = await researchModel.generateContent({
      contents: [{
        role: 'user',
        parts: [{ text: chunk }]
      }]
    });
    
    return result.response.text();
  });

  const results = await Promise.all(researchChain);
  
  // Get actual Firecrawl results
  const firecrawlResponse = await firecrawl.search(query);
  
  return {
    content: results.join('\n\n'),
    sources: firecrawlResponse.data
      .map(result => result.url)
      .filter((url): url is string => typeof url === 'string'), // Type guard
    methodology: 'Semantic chunking with Gemini Flash 2.0',
    limitations: 'Current implementation focuses on text analysis only',
    citations: results.flatMap(r => 
      (r.match(/\[\[\d+\]\]/g) || []).map(ref => ({ reference: ref }))
    ), // Extract citations from content
    learnings: [],    
    visitedUrls: [],
    firecrawlResults: { metadata: { success: false, error: 'No metadata' }, ...firecrawlResponse } as unknown as SearchResponse,
    analysis: ''
  };
}

// Create proper empty ResearchResult objects
const createEmptyResearchResult = (): ResearchResult => ({
  content: '',
  sources: [],
  methodology: '',
  limitations: '',
  citations: [],
  learnings: [],
  visitedUrls: [],
  firecrawlResults: { metadata: {} } as SearchResponse,
  analysis: ''
});

// Add type-safe firecrawl result handling
interface FirecrawlResult {
  url?: string;
  // Add other expected properties
}

// Update the SearchResponse interface to include metadata
interface SearchResponse {
  data: FirecrawlResult[];
  metadata: { success: boolean; error: string }; // Add metadata property
}

// Then use in processFirecrawlData:
const processFirecrawlData = (result: any): SearchResponse => ({
  data: (result?.data || []).filter((item: FirecrawlResult): item is FirecrawlResult => !!item?.url),
  metadata: result?.metadata || { success: false, error: 'No metadata' } // Now matches interface
});

