import FirecrawlApp, { type SearchResponse } from '@mendable/firecrawl-js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';
import pkg from 'lodash';
const { escape } = pkg;

import { trimPrompt, o3MiniModel, learningPromptTemplate } from './ai/providers.js';
import { systemPrompt, serpQueryPromptTemplate } from './prompt.js';
import { RecursiveCharacterTextSplitter } from './ai/text-splitter.js';

// Helper function to log to stderr
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
const log = (...args: any[]) => {
  process.stderr.write(`${args.map(arg =>
    typeof arg === 'string' ? arg : JSON.stringify(arg)
  ).join(' ')}\n`);
};

export type ResearchProgress = {
  currentDepth: number;
  totalDepth: number;
  currentBreadth: number;
  totalBreadth: number;
  currentQuery?: string;
  totalQueries: number;
  completedQueries: number;
};

type ResearchResult = {
  learnings: string[];
  visitedUrls: string[];
};

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
  log("Warning: FIRECRAWL_API_KEY environment variable is not set.  Firecrawl functionality will be limited.");
  // Consider throwing an error here instead, depending on your requirements
}

const googleAI = new GoogleGenerativeAI(GEMINI_API_KEY as string);
const model = googleAI.getGenerativeModel({ model: GEMINI_MODEL });

const firecrawl = new FirecrawlApp({
  apiKey: FIRECRAWL_API_KEY ?? '',
  apiUrl: FIRECRAWL_BASE_URL,
});

const ConcurrencyLimit = CONCURRENCY_LIMIT;

// take en user query, return a list of SERP queries
type SerpQuery = { query: string; researchGoal: string; };

const DEFAULT_NUM_QUERIES = 3;

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

    log(`generateSerpQueries prompt: ${finalPrompt}`);

    const geminiResult = await o3MiniModel.generateContent(finalPrompt);
    log('geminiResult:', JSON.stringify(geminiResult, null, 2));

    const parsedResult = z.object({
      queries: z.array(z.object({
        query: z.string(),
        researchGoal: z.string().default("General research"),
      })),
    }).safeParse(JSON.parse(geminiResult.response.text()));

    if (!parsedResult.success) {
      log('Failed to parse SERP queries:', parsedResult.error);
      log(`Failed prompt: ${finalPrompt}`);
      return [];
    }

    const res = parsedResult.data;
    log('Created queries:', res.queries);

    const uniqueQueries = Array.from(new Set(res.queries.map(q => q.query))).map(q => res.queries.find(query => query.query === q)!);

    return uniqueQueries.slice(0, numQueries);

  } catch (error) {
    if (error instanceof Error) {
      log(`Error in generateSerpQueries: ${error.message}`, { stack: error.stack });
    } else {
      log(`Error in generateSerpQueries: An unknown error occurred`, { error });
    }
    return [];
  }
}

async function processSerpResult({
  query,
  result,
  numLearnings = 3,
}: {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
}): Promise<{ learnings: string[]; followUpQuestions: string[]; }> {
  const contents = compact(result.data.map(item => item.markdown)).map(
    content => trimPrompt(content, 100_000),
  );
  const urls = compact(result.data.map(item => item.url));
  log(`Ran ${query}, found ${contents.length} contents and ${urls.length} URLs:`, urls);

  // Initialize the RecursiveCharacterTextSplitter with a context-aware chunk size
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 140 });

  // Split the contents into smaller chunks
  const chunks = contents.flatMap(content => splitter.splitText(content));

  // Process each chunk with the LLM
  const learnings: string[] = [];

  for (const chunk of chunks) {
    const prompt = learningPromptTemplate
      .replace("{{query}}", query)
      .replace("{{title}}", result.data[0]?.title || "No Title")
      .replace("{{url}}", result.data[0]?.url || "No URL")
      .replace("{{content}}", chunk);

    const o3MiniModel2 = googleAI.getGenerativeModel({ model: "gemini-2.0-pro-exp-02-05" });
    const geminiResult = await o3MiniModel2.generateContent(prompt);

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
    log('Error in generateOutline:', error);
    return 'Outline could not be generated.';
  }
}

// New helper function to write a report from the generated outline and learnings
async function writeReportFromOutline(outline: string, learnings: string[]): Promise<string> {
  try {
    const reportPrompt = `${systemPrompt()}\n\nUsing the following outline and learnings, write a comprehensive research report.\nOutline:\n${outline}\nLearnings:\n${learnings.join("\\n")}`;
    const reportResponse = await o3MiniModel.generateContent(reportPrompt);
    const reportText = await reportResponse.response.text();
    return reportText;
  } catch (error) {
    log('Error in writeReportFromOutline:', error);
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
    log('Error in generateSummary:', error);
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
    log('Error in generateTitle:', error);
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
    log('Research Progress:', progress);
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
    log("Reached research depth limit.");
    return { learnings, visitedUrls };
  }

  if (visitedUrls.length > 20) {
    log("Reached visited URLs limit.");
    return { learnings, visitedUrls };
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

  const limitedProcessResult = async (serpQuery: SerpQuery) => {
    // Declare newUrls and newLearnings here, outside the try block
    let newUrls: string[] = [];
    let newLearnings: ResearchResult['learnings'] = [];
    try {
      if (visitedUrls.includes(serpQuery.query)) {
        log(`Already visited URL for query: ${serpQuery.query}, skipping.`);
        return {
          learnings: [],
          visitedUrls: [],
        }; // Return empty result to avoid affecting overall learnings
      }

      try {
        log(`Firecrawl scraping for query: ${serpQuery.query}...`);
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
          log(`Invalid Firecrawl result for query: ${serpQuery.query}`);
          return {
            learnings: [],
            visitedUrls: [],
          };
        }

        // Collect URLs from this search, using optional chaining for safety
        newUrls = compact(firecrawlResult.data.map(item => item.url));
        const newBreadth = Math.ceil(breadth / 2);
        const newDepth = depth - 1;

        log("Researching deeper...");
        const processResult = await processSerpResult({
          query: serpQuery.query,
          result,
        });
        newLearnings = processResult?.learnings ?? []; // Assign here to pre-declared variable
        const allLearnings = [...learnings, ...newLearnings];
        const allUrls = [...visitedUrls, ...newUrls];

        if (newDepth > 0) {
          log(
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
          log("Reached maximum research depth.");
          return {
            learnings: newLearnings,
            visitedUrls: newUrls,
          };
        }
      } catch (error) {
        log(`Error processing query ${serpQuery.query}: ${error}`);
        return {
          learnings: [],
          visitedUrls: [],
        };
      }
    } finally {
      progress.completedQueries += 1; // Increment completed queries count
      if (reportProgress) {
        reportProgress(progress); // Report progress after each query
      }
    }
  };

  const promises = serpQueries.map((serpQuery) => limit(() => limitedProcessResult(serpQuery)));

  const results = await Promise.all(promises);

  visitedUrls = compact(results.flatMap(result => result?.visitedUrls));
  learnings = compact(results.flatMap(result => result?.learnings));

  return { learnings, visitedUrls };
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
  log("Generating outline...");
  const outline = await generateOutline(prompt, learnings);
  log("Outline generated:", outline);

  log("Writing report from outline...");
  const report = await writeReportFromOutline(outline, learnings);
  log("Report generated.");

  log("Generating summary...");
  const summary = await generateSummary(learnings);
  log("Summary generated.");

  log("Generating title...");
  const title = await generateTitle(prompt, learnings);
  log("Title generated:", title);

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

  log("Final report generated.");
  return finalReport;
}

export async function research(
  { query, breadth, depth, onProgress }: {
    query: string;
    breadth: number;
    depth: number;
    onProgress?: (progress: ResearchProgress) => void; // Make onProgress optional
  }
): Promise<{ learnings: string[]; visitedUrls: string[]; }> {
  log(`Starting research for query: ${query}`);

  const researchResult = await deepResearch({ query, breadth, depth, onProgress });
  log("Deep research completed. Generating final report...");

  const finalReport = await writeFinalReport({
    prompt: query,
    learnings: researchResult.learnings,
    visitedUrls: researchResult.visitedUrls,
  });
  log("Final report written. Research complete.");

  return researchResult;
}

