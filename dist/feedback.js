import { z } from 'zod';
import { o3MiniModel } from './ai/providers.js';
import { systemPrompt } from './prompt.js';
export async function generateFeedback({ query, numQuestions = 3, }) {
    const geminiPrompt = `${systemPrompt()}\n\nGiven the following query from the user, ask some follow up questions to clarify the research direction. Return a maximum of ${numQuestions} questions, but feel free to return less if the original query is clear: <query>${query}</query>`;
    const geminiResponse = await o3MiniModel.generateContent(geminiPrompt);
    const textResponse = await geminiResponse.response.text();
    try {
        const parsedResult = z.object({
            questions: z.array(z.string())
        }).safeParse(JSON.parse(textResponse));
        if (!parsedResult.success) {
            console.error("Failed to parse feedback questions:", parsedResult.error);
            return [];
        }
        return parsedResult.data.questions.slice(0, numQuestions);
    }
    catch (error) {
        console.error("Error generating feedback:", error);
        return [];
    }
}
