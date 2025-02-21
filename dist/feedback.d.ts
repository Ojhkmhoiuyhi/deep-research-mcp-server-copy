import { z } from 'zod';
interface FeedbackOptions {
    query: string;
    numQuestions?: number;
    researchGoal?: string;
    depth?: number;
    breadth?: number;
    existingLearnings?: string[];
}
declare const FeedbackResponseSchema: z.ZodObject<{
    followUpQuestions: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    analysis: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    followUpQuestions?: string[] | undefined;
    analysis?: string | undefined;
}, {
    followUpQuestions?: string[] | undefined;
    analysis?: string | undefined;
}>;
type FeedbackResponse = z.infer<typeof FeedbackResponseSchema>;
export declare function generateFeedback({ query, numQuestions, researchGoal, depth, breadth, existingLearnings, }: FeedbackOptions): Promise<FeedbackResponse>;
export {};
//# sourceMappingURL=feedback.d.ts.map