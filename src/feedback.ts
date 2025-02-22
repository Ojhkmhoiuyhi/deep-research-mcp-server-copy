import { LRUCache } from 'lru-cache';
import pRetry from 'p-retry';
import { z } from 'zod';

import { o3MiniModel } from './ai/providers.js';
import { OutputManager } from './output-manager.js';
import { feedbackPromptTemplate, systemPrompt } from './prompt.js';

interface FeedbackOptions {
  query: string;
  numQuestions?: number;
  researchGoal?: string;
  depth?: number;
  breadth?: number;
  existingLearnings?: string[];
}

const output = new OutputManager();

// Create LRU cache for feedback responses
const feedbackCache = new LRUCache<string, FeedbackResponse>({
  max: 50, // Adjust max size as needed
});

// Define Zod schema for expected JSON response from Gemini
const FeedbackResponseSchema = z.object({
    followUpQuestions: z.array(z.string()).optional(), // Follow-up questions are optional
    analysis: z.string().optional(), // General analysis or feedback is optional
});

type FeedbackResponse = z.infer<typeof FeedbackResponseSchema>;

// Refined prompt should be used here


// Assume this function retrieves past research interactions and analyzes their effectiveness
async function analyzePastFeedback(query: string): Promise<string> {
  // ... (Implementation to retrieve and analyze past feedback) ...
  const keywords = ["example", "test", "dummy"]; // Example keywords - customize as needed
  let feedback = "No specific feedback generated from past queries yet.";

  for (const keyword of keywords) {
    if (query.toLowerCase().includes(keyword)) {
      feedback = `Query contains keyword "${keyword}". Consider refining the query to be more specific.`;
      break; // Stop after finding the first keyword for this basic example
    }
  }
  output.log(`Analyzed past feedback for query: "${query}". Feedback: ${feedback}`); // Log feedback analysis
  return feedback;
}

export async function generateFeedback({
  query,
  numQuestions = 3,
  researchGoal = "Understand the user's query",
  depth = 1,
  breadth = 1,
  existingLearnings = [],
}: FeedbackOptions): Promise<FeedbackResponse> {
  // 1. Create cache key
  let cacheKey: string;
  try {
    const keyObject: any = { query, numQuestions, researchGoal, depth, breadth, existingLearnings };
    // Omit default values for a more efficient key (optional, as before)
    if (numQuestions === 3) delete keyObject.numQuestions;
    if (researchGoal === "Understand the user's query") delete keyObject.researchGoal;
    if (depth === 1) delete keyObject.depth;
    if (breadth === 1) delete keyObject.breadth;
    const learningsHash = existingLearnings.length > 0 ? String(existingLearnings.reduce((acc, val) => acc + val.charCodeAt(0), 0)) : ''; // Hash learnings
    keyObject.learningsHash = learningsHash;
    cacheKey = JSON.stringify(keyObject);
  } catch (keyError) {
    console.error("Error creating feedback cache key:", keyError);
    cacheKey = 'default-feedback-key'; // Fallback key in case of error
  }

  // 2. Check cache
  try {
    const cachedFeedback = feedbackCache.get(cacheKey);
    if (cachedFeedback) {
      output.log(`Returning cached feedback for key: ${cacheKey}`);
      return cachedFeedback;
    }
  } catch (cacheGetError) {
    console.error("Error getting feedback from cache:", cacheGetError);
    // Continue without cache if there's an error
  }

  const context = `
Research Goal: ${researchGoal}
Current Depth: ${depth}
Current Breadth: ${breadth}
Existing Learnings: ${existingLearnings.join('\n')}
`;

  // Get feedback from past interactions
  const pastFeedback = await analyzePastFeedback(query);

  // Use feedbackPromptTemplate and replace variables correctly
  const geminiPrompt = `${systemPrompt()}\n\n${context}\n\n${pastFeedback}\n\n${feedbackPromptTemplate
    .replace("{{query}}", query) // Use "{{query}}" in feedbackPromptTemplate, not "{{userQuery}}"
    .replace("{{numQuestions}}", String(numQuestions)) // Replace numQuestions placeholder
  }`;

  let feedbackResponse: FeedbackResponse = { analysis: "Initial feedback response." }; // Initialize with default
  try {
    const textResponse = await pRetry(
      async () => {
        output.log(`Generating feedback for query: "${query}"...`); // Log using OutputManager
        const response = await o3MiniModel.generateContent(geminiPrompt);
        const text = response.response?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error('Empty Gemini API response.');
        }
        return text;
      },
      {
        retries: 3, // Number of retries
        onFailedAttempt: error => {
          output.log(`Gemini Feedback API call failed (attempt ${error.attemptNumber}): ${error}`); // Log retry attempts
        },
      }
    );

    output.log(`Gemini Feedback API response received.`); // Log successful response

    // Attempt to parse JSON response from Gemini
    try {
      feedbackResponse = FeedbackResponseSchema.parse(JSON.parse(textResponse)); // Parse with Zod
      output.log(`Parsed Feedback Response (JSON):\n${JSON.stringify(feedbackResponse, null, 2)}`); // Log parsed JSON
    } catch (jsonError) {
      output.log(`Error parsing Gemini JSON response: ${jsonError}`);
      output.log(`Raw Gemini Response causing JSON error:\n${textResponse}`); // Log the problematic raw response
      // Consider setting a default or error feedback response here if JSON parsing fails critically
      feedbackResponse = { analysis: "Failed to parse feedback response. Please check logs for raw output." }; // Provide a fallback
    }

    // 3. Store in cache after successful API call and parsing
    try {
      feedbackCache.set(cacheKey, feedbackResponse);
      output.log(`Cached feedback for key: ${cacheKey}`);
    } catch (cacheSetError) {
      console.error("Error setting feedback to cache:", cacheSetError);
    }

  } catch (apiError) {
    output.log(`Gemini API error during feedback generation: ${apiError}`);
    feedbackResponse = { analysis: "Error generating feedback. Please check API key and logs." }; // API error fallback
  } finally {
    return feedbackResponse; // Return the feedback response object (either parsed or fallback)
  }
}
