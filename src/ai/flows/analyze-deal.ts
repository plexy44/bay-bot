
'use server';

/**
 * @fileOverview An AI agent that analyzes a deal to provide a risk and rarity score.
 *
 * - analyzeDeal - A function that handles the deal analysis process.
 * - AnalyzeDealInput - The input type for the analyzeDeal function.
 * - AnalyzeDealOutput - The return type for the analyzeDeal function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AnalyzeDealInputSchema = z.object({
  title: z.string().describe('The title of the deal.'),
  description: z.string().describe('A detailed description of the deal.'),
  price: z.number().describe('The current price of the deal.'),
  originalPrice: z.number().describe('The original price of the deal.'),
  discountPercentage: z.number().describe('The discount percentage of the deal.'),
  imageUrl: z.string().describe('URL of the image associated with the deal.'),
});
export type AnalyzeDealInput = z.infer<typeof AnalyzeDealInputSchema>;

const AnalyzeDealOutputSchema = z.object({
  riskScore: z
    .number()
    .min(0)
    .max(100)
    .describe(
      'A score between 0 and 100 indicating the risk associated with the deal, with higher scores indicating higher risk.'
    ),
  rarityScore:
    z
      .number()
      .min(0)
      .max(100)
      .describe(
        'A score between 0 and 100 indicating the rarity of the deal, with higher scores indicating rarer deals.'
      ),
  summary: z.string().describe('A summary of why the deal has the risk and rarity scores assigned.'),
});
export type AnalyzeDealOutput = z.infer<typeof AnalyzeDealOutputSchema>;

export async function analyzeDeal(input: AnalyzeDealInput): Promise<AnalyzeDealOutput> {
  return analyzeDealFlow(input);
}

const prompt = ai.definePrompt({
  name: 'analyzeDealPrompt',
  input: {schema: AnalyzeDealInputSchema},
  output: {schema: AnalyzeDealOutputSchema},
  prompt: `You are an expert deal analyst specializing in assessing the risk and rarity of online deals.

You will use the following information to analyze the deal and determine its risk and rarity.

Title: {{{title}}}
Description: {{{description}}}
Price: {{{price}}}
Original Price: {{{originalPrice}}}
Discount Percentage: {{{discountPercentage}}}
Image URL: {{{imageUrl}}}

Based on this information, provide a riskScore and rarityScore for the deal, and a summary of your analysis.
The riskScore should be a number between 0 and 100, with higher scores indicating higher risk.
The rarityScore should be a number between 0 and 100, with higher scores indicating rarer deals.
`,
});

const analyzeDealFlow = ai.defineFlow(
  {
    name: 'analyzeDealFlow',
    inputSchema: AnalyzeDealInputSchema,
    outputSchema: AnalyzeDealOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    if (!output) {
      console.error('AI analysis prompt failed to return output for input:', input);
      throw new Error('AI analysis failed to produce a result.');
    }
    return output;
  }
);
