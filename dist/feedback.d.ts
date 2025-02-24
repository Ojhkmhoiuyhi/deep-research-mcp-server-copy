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
    followUpQuestions: z.ZodArray<z.ZodString, "many">;
    analysis: z.ZodString;
    confidenceScore: z.ZodOptional<z.ZodNumber>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    followUpQuestions: z.ZodArray<z.ZodString, "many">;
    analysis: z.ZodString;
    confidenceScore: z.ZodOptional<z.ZodNumber>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    followUpQuestions: z.ZodArray<z.ZodString, "many">;
    analysis: z.ZodString;
    confidenceScore: z.ZodOptional<z.ZodNumber>;
}, z.ZodTypeAny, "passthrough">>;
export type FeedbackResponse = z.infer<typeof FeedbackResponseSchema>;
export declare function generateFeedback({ query, numQuestions, researchGoal, depth, breadth, existingLearnings, }: FeedbackOptions): Promise<FeedbackResponse>;
export {};
//# sourceMappingURL=feedback.d.ts.map