import FirecrawlApp, { type SearchResponse } from '@mendable/firecrawl-js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';

import { trimPrompt, o3MiniModel } from './ai/providers.js';
import { systemPrompt } from './prompt.js';

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

// increase this if you have higher API rate limits
const ConcurrencyLimit = 2;

// Initialize Firecrawl with optional API key and optional base url
const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_API_KEY ?? '',
  apiUrl: process.env.FIRECRAWL_BASE_URL,
});

// Initialize Gemini API once, using the correct model ID
if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable is not set');
}
const googleAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
const model = googleAI.getGenerativeModel({ model: "gemini-2.0-pro-exp-02-05" });

// Example: Enhanced prompt for generating SERP queries
const serpQueryPromptTemplate = `
You are an expert researcher and SEO specialist. Given the following prompt from the user, generate a list of SERP queries to research the topic. Return a maximum of {{numQueries}} queries, but feel free to return less if the original prompt is clear. Make sure each query is unique and not similar to each other. Each query should be optimized for search engines and designed to retrieve relevant and high-quality results.

User Prompt: {{query}}

{% if learnings %}
Here are some learnings from previous research, use them to generate more specific queries: {{learnings.join('\n')}}
{% endif %}
`;

// take en user query, return a list of SERP queries
async function generateSerpQueries({
  query,
  numQueries = 3,
  learnings,
}: {
  query: string;
  numQueries?: number;
  learnings?: string[];
}): Promise<{ query: string; researchGoal: string; }[]> {

  const prompt = serpQueryPromptTemplate
    .replace('{{numQueries}}', numQueries.toString())
    .replace('{{query}}', query);

  const geminiResult = await model.generateContent(`${systemPrompt()}\n\n${prompt}\n\n${
    learnings
      ? `Here are some learnings from previous research, use them to generate more specific queries: ${learnings.join('\\n')}`
      : ''
  }`);

  log('geminiResult:', JSON.stringify(geminiResult, null, 2));
  if (!geminiResult.response?.text) {
    log('geminiResult.response.text is missing, cannot parse queries.');
    return [];
  }

  try {
    if (!geminiResult.response?.candidates?.[0]?.content?.parts?.[0]) {
      log('geminiResult.response.text is missing, cannot parse queries.');
      return [];
    }
    const geminiText = geminiResult.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!geminiText) {
      log('geminiResult.response.text is missing, cannot parse queries.');
      return [];
    }
    const parsedResult = z.object({
      queries: z.array(z.object({ query: z.string(), researchGoal: z.string() }))
    }).safeParse(JSON.parse(geminiText));
    if (!parsedResult.success) {
      log('Failed to parse queries:', parsedResult.error);
      return [];
    }
    const res = parsedResult.data ?? { queries: [] };

    log('Created queries:', res.queries);

    return res.queries.slice(0, numQueries);
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  } catch (e: any) {
    log('Error in generateSerpQueries:', e);
    return [];
  }
}

async function processSerpResult({
  query,
  result,
  numLearnings = 3,
  numFollowUpQuestions = 3,
}: {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
  numFollowUpQuestions?: number;
}): Promise<{ learnings: string[]; followUpQuestions: string[]; }> {    const contents = compact(result.data.map(item => item.markdown)).map(
    content => trimPrompt(content, 100_000),
  );
  const urls = compact(result.data.map(item => item.url));
  log(`Ran ${query}, found ${contents.length} contents and ${urls.length} URLs:`, urls);

  const googleAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
  const model = googleAI.getGenerativeModel({ model: "gemini-2.0-pro-exp-02-05" });
    const geminiResult = await o3MiniModel.generateContent(
    `${systemPrompt()}\n\nGiven the following contents from a SERP search for the query <query>${query}</query>, generate a list of learnings from the contents. Return a maximum of ${numLearnings} learnings, but feel free to return less if the contents are clear. Make sure each learning is unique and not similar to each other. The learnings should be concise and to the point, as detailed and information dense as possible. Make sure to include any entities like people, places, companies, products, things, etc in the learnings, as well as any exact metrics, numbers, or dates. The learnings will be used to research the topic further.\n\n<contents>${contents
      .map(content => `<content>\n${content}\n</content>`)
      .join('\n')}</contents>`);
  log('geminiResult:', JSON.stringify(geminiResult, null, 2));
  const parsedResult = z.object({
    learnings: z.array(z.string()),
    followUpQuestions: z.array(z.string()),
  }).safeParse(JSON.parse(geminiResult.response.text()));
  if (!parsedResult.success) {
    log('Failed to parse learnings:', parsedResult.error);

    return { learnings: [], followUpQuestions: [] };
  }

  return { learnings: parsedResult.data.learnings ?? [], followUpQuestions: parsedResult.data.followUpQuestions.slice(0, numFollowUpQuestions) ?? [] };
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

// Modify writeFinalReport to export it
export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
}): Promise<string> {
  try {
    log('Writing final report with:', {
      numLearnings: learnings.length,
      numUrls: visitedUrls.length,
      urls: visitedUrls
    });

    // 1. Generate outline
    const outline = await generateOutline(prompt, learnings);

    // 2. Write report based on outline
    const report = await writeReportFromOutline(outline, learnings);

    // Append the visited URLs section to the report
    const urlsSection = `\n\n## Sources\n\n${visitedUrls.map(url => `- ${url}`).join("\\n")}`;
    log('Generated URL section:', urlsSection);
    return report + urlsSection;
  } catch (error) {
    log('Error in writeFinalReport:', error);
    return 'Final report generation failed.';
  }
}

export async function deepResearch({
  query,
  breadth,
  depth,
  learnings = [],
  visitedUrls = [],
  onProgress,
}: {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  visitedUrls?: string[];
  onProgress?: (progress: ResearchProgress) => void;
}): Promise<ResearchResult> {
  const progress: ResearchProgress = {
    currentDepth: depth,
    totalDepth: depth,
    currentBreadth: breadth,
    totalBreadth: breadth,
    totalQueries: 0,
    completedQueries: 0,
  };

  const reportProgress = (update: Partial<ResearchProgress>) => {
    Object.assign(progress, update);
    onProgress?.(progress);
  };

  log("Generating SERP queries...");
  const serpQueries = await generateSerpQueries({
    query,
    learnings,
    numQueries: breadth,
  });

  reportProgress({
    totalQueries: serpQueries.length,
    currentQuery: serpQueries[0]?.query
  });

  const plimit = pLimit(ConcurrencyLimit);

  log("Processing SERP results...");
  const results = await Promise.all(
    serpQueries.map((serpQuery) => plimit(async () => {
      try {
        const result = await firecrawl.search(serpQuery.query, {
          timeout: 15000,
          limit: breadth,
          scrapeOptions: { formats: ['markdown'] },
        });

        if (!result || !result.data) {
          log(`Invalid Firecrawl result for query: ${serpQuery.query}`);
          return {
            learnings: [],
            visitedUrls: [],
          };
        }

        // Collect URLs from this search
        const newUrls = compact(result.data.map(item => item.url));
        const newBreadth = Math.ceil(breadth / 2);
        const newDepth = depth - 1;

        log("Researching deeper...");
        const newLearnings = await processSerpResult({
          query: serpQuery.query,
          result,
          numFollowUpQuestions: newBreadth,
        });
        const allLearnings = [...learnings, ...newLearnings.learnings];
        const allUrls = [...visitedUrls, ...newUrls];

        if (newDepth > 0) {
          log(
            `Researching deeper, breadth: ${newBreadth}, depth: ${newDepth}`,
          );

          reportProgress({
            currentDepth: newDepth,
            currentBreadth: newBreadth,
            completedQueries: progress.completedQueries + 1,
            currentQuery: serpQuery.query,
          });

          const nextQuery = `
            Previous research goal: ${serpQuery.researchGoal}
            Follow-up research directions: ${newLearnings.followUpQuestions.map(q => `\n${q}`).join('')}
          `.trim();

          return deepResearch({
            query: nextQuery,
            breadth: newBreadth,
            depth: newDepth,
            learnings: allLearnings,
            visitedUrls: allUrls,
            onProgress,
          });
        }
        reportProgress({
          currentDepth: 0,
          completedQueries: progress.completedQueries + 1,
          currentQuery: serpQuery.query,
        });
        return {
          learnings: allLearnings,
          visitedUrls: allUrls,
        };
      } catch (e: any) {
        log(`Firecrawl search failed for query ${serpQuery.query}: ${e}`);
        return {
          learnings: [],
          visitedUrls: [],
        };
      }
    }))
  );

  return {
    learnings: [...new Set(results.flatMap(r => r.learnings))],
    visitedUrls: [...new Set(results.flatMap(r => r.visitedUrls))],
  };
}
