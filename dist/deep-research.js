import { z } from 'zod';
import FirecrawlApp from '@mendable/firecrawl-js';
import { LRUCache } from 'lru-cache';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import pkg from 'lodash';
const { escape } = pkg;
import { o3MiniModel, o3MiniModel2, callGeminiProConfigurable, generateTextEmbedding } from './ai/providers.js';
import { systemPrompt, serpQueryPromptTemplate, learningPromptTemplate, generateGeminiPrompt } from './prompt.js';
import { RecursiveCharacterTextSplitter } from './ai/text-splitter.js';
import { extractJsonFromText, safeParseJSON, stringifyJSON } from './utils/json.js';
import { OutputManager } from './output-manager.js';
import { sanitizeReportContent } from './utils/sanitize.js';
import { researchModel } from './ai/providers.js';
import { SemanticTextSplitter } from './ai/text-splitter.js';
const output = new OutputManager();
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
const DEFAULT_NUM_QUERIES = 3;
// Create an LRU cache instance
const serpQueryCache = new LRUCache({
    max: 50, // Maximum number of items in the cache
});
// Create LRU cache for final reports
const reportCache = new LRUCache({
    max: 20, // Adjust max size as needed
});
function logResearchProgress(progressData) {
    const prettyProgressJson = stringifyJSON(progressData, true); // Pretty print for logs
    if (prettyProgressJson) {
        output.log("Research Progress Update:\n", prettyProgressJson); // Log pretty JSON
    }
    else {
        output.log("Error stringifying research progress data for logging.");
        output.log("Raw progress data:", progressData); // Fallback to raw object if stringify fails
    }
}
function cacheSearchResults(query, results) {
    const minifiedResultsJson = stringifyJSON(results); // Minified for efficient storage
    if (minifiedResultsJson) {
        // ... code to store minifiedResultsJson in your cache (e.g., LRUCache) ...
        output.log(`Cached results for query: "${query}" (JSON length: ${minifiedResultsJson.length})`);
    }
    else {
        output.log("Error stringifying search results for caching.");
        // Handle caching error
    }
}
async function generateSerpQueries({ query: rawQuery, numQueries = DEFAULT_NUM_QUERIES, learnings = [], researchGoal = "Initial query", initialQuery, depth = 1, breadth = 1, }) {
    try {
        // 1. Create a cache key
        let cacheKey;
        try {
            const keyObject = { rawQuery, numQueries, researchGoal, initialQuery, depth, breadth };
            // Omit default values from the cache key
            if (numQueries === DEFAULT_NUM_QUERIES)
                delete keyObject.numQueries;
            if (researchGoal === "Initial query")
                delete keyObject.researchGoal;
            if (initialQuery === rawQuery)
                delete keyObject.initialQuery; // Assuming initialQuery defaults to rawQuery
            if (depth === 1)
                delete keyObject.depth;
            if (breadth === 1)
                delete keyObject.breadth;
            // Hash the learnings array (example using a simple hash function)
            const learningsHash = learnings.length > 0 ? String(learnings.reduce((acc, val) => acc + val.charCodeAt(0), 0)) : '';
            keyObject.learningsHash = learningsHash;
            cacheKey = JSON.stringify(keyObject);
        }
        catch (e) {
            output.log("Error creating cache key:", e);
            cacheKey = rawQuery; // Fallback to a simple key
        }
        // 2. Check if the result is in the cache
        try {
            const cachedResult = serpQueryCache.get(cacheKey);
            if (cachedResult) {
                output.log(`Returning cached SERP queries for key: ${cacheKey}`);
                return cachedResult;
            }
        }
        catch (e) {
            output.log("Error getting from cache:", e);
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
        let geminiResult;
        let jsonString = '{}';
        try {
            geminiResult = await o3MiniModel.generateContent(finalPrompt);
            output.log('geminiResult:', JSON.stringify(geminiResult, null, 2));
            const geminiText = geminiResult.response?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (typeof geminiText === 'string') {
                jsonString = geminiText;
            }
            else {
                output.log("Error: Gemini response text is not a string or is missing.");
                jsonString = '{}';
            }
        }
        catch (error) {
            output.log("Error: Unexpected structure in Gemini response - cannot access text.");
            output.log("Gemini response:", geminiResult);
            jsonString = '{}';
        }
        const rawQueriesJSON = extractJsonFromText(jsonString);
        let serpQueries = [];
        if (rawQueriesJSON && Array.isArray(rawQueriesJSON)) {
            serpQueries = rawQueriesJSON.slice(0, numQueries)
                .map((rawQuery) => {
                const parsedQuery = SerpQuerySchema.safeParse({
                    query: rawQuery?.query || rawQuery, // Handle cases where query is directly a string or in an object
                    researchGoal: researchGoal, // Or get researchGoal from rawQuery if available
                });
                return parsedQuery.success ? parsedQuery.data : null; // Return parsed data or null if parsing fails
            })
                .filter(Boolean); // Filter out null values from failed parses
        }
        else {
            output.log("Failed to generate or parse SERP queries from Gemini response, using fallback to empty array.");
            serpQueries = [];
        }
        // 4. Store the result in the cache
        try {
            serpQueryCache.set(cacheKey, serpQueries);
            output.log(`Cached SERP queries for key: ${cacheKey}`);
        }
        catch (e) {
            output.log("Error setting to cache:", e);
        }
        return serpQueries;
    }
    catch (error) {
        output.log("Error in generateSerpQueries:", error);
        return []; // Return an empty array in case of any error during query generation
    }
}
async function processSerpResult({ query, result, numLearnings = 3, }) {
    const contents = compact(result.data.map(item => item.markdown)).map(content => content);
    const resolvedContents = await Promise.all(contents);
    const urls = compact(result.data.map(item => item.url));
    output.log(`Ran ${query}, found ${contents.length} contents and ${urls.length} URLs:`, urls);
    // Initialize the RecursiveCharacterTextSplitter with a context-aware chunk size
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 140 });
    // Split the contents into smaller chunks
    const chunks = resolvedContents.flatMap((content) => splitter.splitText(content));
    // Process each chunk with the LLM
    const learnings = [];
    for (const chunk of chunks) {
        const prompt = learningPromptTemplate
            .replace("{{query}}", query)
            .replace("{{title}}", result.data[0]?.title || "No Title")
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
async function generateOutline(prompt, learnings) {
    try {
        const outlinePrompt = `${systemPrompt()}\n\nBased on the prompt and the following learnings, generate a detailed outline for a research report:\nPrompt: ${prompt}\nLearnings:\n${learnings.join("\\n")}`;
        const outlineResponse = await o3MiniModel.generateContent(outlinePrompt);
        const outlineText = await outlineResponse.response.text();
        return outlineText;
    }
    catch (error) {
        output.log('Error in generateOutline:', error);
        return 'Outline could not be generated.';
    }
}
// New helper function to write a report from the generated outline and learnings
async function writeReportFromOutline(outline, learnings) {
    // Add sanitization step
    const cleanOutline = sanitizeReportContent(outline);
    const cleanLearnings = learnings.map(sanitizeReportContent);
    try {
        const reportPrompt = `${systemPrompt()}\n\nUsing the following outline and learnings, write a comprehensive research report.\nOutline:\n${cleanOutline}\nLearnings:\n${cleanLearnings.join("\\n")}`;
        const reportResponse = await o3MiniModel.generateContent(reportPrompt);
        const reportText = await reportResponse.response.text();
        return reportText;
    }
    catch (error) {
        output.log('Error in writeReportFromOutline:', error);
        return 'Report could not be generated.';
    }
}
// New helper function to generate a summary from the learnings
async function generateSummary(learnings) {
    try {
        const summaryPrompt = `${systemPrompt()}\n\nGenerate a concise summary of the following learnings:\nLearnings:\n${learnings.join("\\n")}`;
        const summaryResponse = await o3MiniModel.generateContent(summaryPrompt);
        const summaryText = await summaryResponse.response.text();
        return summaryText;
    }
    catch (error) {
        output.log('Error in generateSummary:', error);
        return 'Summary could not be generated.';
    }
}
// New helper function to generate a title from the prompt and learnings
async function generateTitle(prompt, learnings) {
    try {
        const titlePrompt = `${systemPrompt()}\n\nGenerate a concise and informative title for a research report based on the prompt and learnings:\nPrompt: ${prompt}\nLearnings:\n${learnings.join("\\n")}`;
        const titleResponse = await o3MiniModel.generateContent(titlePrompt);
        const titleText = await titleResponse.response.text();
        return titleText;
    }
    catch (error) {
        output.log('Error in generateTitle:', error);
        return 'Title could not be generated.';
    }
}
const DEFAULT_DEPTH = 2;
const DEFAULT_BREADTH = 5;
async function deepResearch({ query, depth = DEFAULT_DEPTH, breadth = DEFAULT_BREADTH, learnings: initialLearnings = [], visitedUrls: initialVisitedUrls = [], onProgress, reportProgress = (progress) => {
    output.log('Research Progress:', progress);
}, initialQuery = query, researchGoal = "Deep dive research", }) {
    let visitedUrls = [...initialVisitedUrls];
    let learnings = [...initialLearnings];
    // Initialize progress object
    let progress = {
        currentDepth: depth,
        totalDepth: depth,
        currentBreadth: breadth,
        totalBreadth: breadth,
        totalQueries: breadth * depth,
        completedQueries: 0,
    };
    if (depth <= 0) {
        output.log("Reached research depth limit.");
        return { content: '', sources: [], methodology: '', limitations: '', citations: [], learnings: [], visitedUrls: [] };
    }
    if (visitedUrls.length > 20) {
        output.log("Reached visited URLs limit.");
        return { content: '', sources: [], methodology: '', limitations: '', citations: [], learnings: [], visitedUrls: [] };
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
    const limitedProcessResult = async (serpQuery) => {
        let newLearnings = [];
        let newUrls = [];
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
                    learnings: [],
                    visitedUrls: [],
                }; // Return empty result to avoid affecting overall learnings
            }
            try {
                output.log(`Firecrawl scraping for query: ${serpQuery.query}...`);
                const result = await firecrawl.search(serpQuery.query, {
                    timeout: 15000,
                    limit: breadth,
                    scrapeOptions: { formats: ['markdown'] },
                });
                // Add type assertion to result to ensure TypeScript knows the structure
                const firecrawlResult = result;
                if (!firecrawlResult || !firecrawlResult.data) {
                    output.log(`Invalid Firecrawl result for query: ${serpQuery.query}`);
                    return {
                        learnings: [],
                        visitedUrls: [],
                    };
                }
                // Collect URLs from this search, using optional chaining for safety
                newUrls = compact(firecrawlResult.data.map(item => item.url));
                const newBreadth = Math.ceil(breadth / 2);
                const newDepth = depth - 1;
                output.log("Researching deeper...");
                const processResult = await processSerpResult({
                    query: serpQuery.query,
                    result,
                });
                const newLearnings = processResult?.learnings ?? []; // Assign here to pre-declared variable
                const allLearnings = [...learnings, ...newLearnings];
                const allUrls = [...visitedUrls, ...newUrls];
                if (newDepth > 0) {
                    output.log(`Researching deeper, breadth: ${newBreadth}, depth: ${newDepth}`);
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
                }
                else {
                    output.log("Reached maximum research depth.");
                    return {
                        content: newLearnings.join('\n\n'),
                        sources: [],
                        methodology: 'Semantic chunking with Gemini Flash 2.0',
                        limitations: 'Current implementation focuses on text analysis only',
                        citations: [],
                        learnings: newLearnings,
                        visitedUrls: newUrls
                    };
                }
            }
            catch (error) {
                output.log(`Error processing query ${serpQuery.query}: ${error}`);
                return {
                    content: '',
                    sources: [],
                    methodology: '',
                    limitations: '',
                    citations: [],
                    learnings: [],
                    visitedUrls: []
                };
            }
            finally {
                progress.completedQueries += 1; // Increment completed queries count
                if (reportProgress) {
                    reportProgress(progress); // Report progress after each query
                }
            }
        }
        catch (error) {
            output.log(`Error processing query ${serpQuery.query}: ${error}`);
            return {
                content: '',
                sources: [],
                methodology: '',
                limitations: '',
                citations: [],
                learnings: [],
                visitedUrls: []
            };
        }
    };
    const promises = serpQueries.map((serpQuery) => limit(() => limitedProcessResult(serpQuery)));
    const results = await Promise.all(promises);
    visitedUrls = compact(results.flatMap((result) => result?.visitedUrls));
    learnings = compact(results.flatMap((result) => result?.learnings));
    return {
        content: learnings.join('\n\n'),
        sources: [],
        methodology: 'Semantic chunking with Gemini Flash 2.0',
        limitations: 'Current implementation focuses on text analysis only',
        citations: [],
        learnings: learnings,
        visitedUrls: visitedUrls
    };
}
export async function writeFinalReport({ prompt, learnings, visitedUrls, }) {
    // 1. Create cache key
    let cacheKey;
    try {
        const keyObject = { prompt };
        const learningsHash = learnings.length > 0 ? String(learnings.reduce((acc, val) => acc + val.charCodeAt(0), 0)) : ''; // Hash learnings
        keyObject.learningsHash = learningsHash;
        const visitedUrlsHash = visitedUrls.length > 0 ? String(visitedUrls.reduce((acc, val) => acc + val.charCodeAt(0), 0)) : ''; // Hash visitedUrls (optional)
        keyObject.visitedUrlsHash = visitedUrlsHash; // Include visitedUrls hash in key (optional)
        cacheKey = JSON.stringify(keyObject);
    }
    catch (keyError) {
        output.log("Error creating report cache key:", keyError);
        cacheKey = 'default-report-key'; // Fallback key
    }
    // 2. Check cache
    try {
        const cachedReport = reportCache.get(cacheKey);
        if (cachedReport) {
            output.log(`Returning cached report for key: ${cacheKey}`);
            return cachedReport;
        }
    }
    catch (cacheGetError) {
        output.log("Error getting report from cache:", cacheGetError);
        // Continue without cache if error
    }
    output.log("Generating outline...");
    const outline = await generateOutline(prompt, learnings);
    output.log("Outline generated:", outline);
    output.log("Writing report from outline...");
    const report = await writeReportFromOutline(outline, learnings);
    output.log("Report generated.");
    output.log("Generating summary...");
    const summary = await generateSummary(learnings);
    output.log("Summary generated.");
    output.log("Generating title...");
    const title = await generateTitle(prompt, learnings);
    output.log("Title generated:", title);
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
    output.log("Final report generated.");
    // 3. Store report in cache
    try {
        reportCache.set(cacheKey, finalReport);
        output.log(`Cached report for key: ${cacheKey}`);
    }
    catch (cacheSetError) {
        output.log("Error setting report to cache:", cacheSetError);
    }
    output.saveResearchReport(finalReport);
    return finalReport;
}
export async function research(options) {
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
async function someFunction() {
    const textToEmbed = "This is the text I want to embed.";
    const embedding = await generateTextEmbedding(textToEmbed);
    if (embedding) {
        output.log("Generated Embedding:", embedding);
        // ... use the embedding for semantic search, clustering, etc. ...
    }
    else {
        output.log("Failed to generate text embedding.");
    }
}
async function processGeminiResponse(geminiResponseText) {
    const responseData = safeParseJSON(geminiResponseText, { items: [] });
    let learnings = [];
    let urls = [];
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
    return {
        learnings: learnings.slice(0, 10), // Changed from 5 to 10
        urls: Array.from(new Set(urls)) // Deduplicate URLs
    };
}
function validateAcademicOutput(text) {
    const validationMetrics = {
        citationDensity: (text.match(/\[\[\d+\]\]/g) || []).length / (text.split(/\s+/).length / 100),
        recentSources: (text.match(/\[\[\d{4}\]\]/g) || []).filter(yr => parseInt(yr) > 2019).length,
        conflictDisclosures: text.includes("Conflict Disclosure:") ? 1 : 0
    };
    return validationMetrics.citationDensity > 1.5 &&
        validationMetrics.recentSources > 3 &&
        validationMetrics.conflictDisclosures === 1;
}
// Update conductResearch return type
export async function conductResearch(query, depth = 3) {
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
    return {
        content: results.join('\n\n'),
        sources: [], // Add actual sources
        methodology: 'Semantic chunking with Gemini Flash 2.0',
        limitations: 'Current implementation focuses on text analysis only',
        citations: [], // Add actual citations
        learnings: [], // Add empty arrays to satisfy interface
        visitedUrls: [] // Add empty arrays to satisfy interface
    };
}
