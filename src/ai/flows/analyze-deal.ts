
'use server';

/**
 * @fileOverview An AI agent that analyzes a deal to provide a risk and rarity score, and relevant keywords.
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
        'A score between 0 and 100 indicating the rarity of the deal. Assign lower scores to common, mass-produced items, even if they are good deals. Higher scores are for genuinely hard-to-find items (vintage, limited edition, very specific configurations, or truly exceptional short-lived deals on popular items).'
      ),
  keywords: z
    .array(z.string())
    .min(3)
    .max(5)
    .describe(
      'An array of 3 to 5 relevant keywords extracted from the deal, such as brand, category, or key features. These should be concise and suitable for initiating new searches.'
    ),
});
export type AnalyzeDealOutput = z.infer<typeof AnalyzeDealOutputSchema>;

export async function analyzeDeal(input: AnalyzeDealInput): Promise<AnalyzeDealOutput> {
  return analyzeDealFlow(input);
}

const prompt = ai.definePrompt({
  name: 'analyzeDealPrompt',
  input: {schema: AnalyzeDealInputSchema},
  output: {schema: AnalyzeDealOutputSchema},
  prompt: `You are an expert deal analyst specializing in assessing the risk and rarity of online deals, and extracting relevant keywords.

You will use the following information to analyze the deal:

Title: {{{title}}}
Description: {{{description}}}
Price: {{{price}}}
Original Price: {{{originalPrice}}}
Discount Percentage: {{{discountPercentage}}}
Image URL: {{{imageUrl}}}

Based on this information:
1.  Provide a riskScore (0-100, higher is riskier).
2.  Provide a rarityScore (0-100). For rarityScore, be mindful:
    *   Assign **LOWER** scores to common, easily available, mass-produced items (e.g., a standard current model iPhone, a common brand of kitchen appliance) even if the deal itself is good.
    *   Assign **HIGHER** scores to items that are genuinely hard to find, such as vintage items, limited editions, very specific or uncommon configurations/models, or truly exceptional, short-lived deep discounts on popular items that make them unusually scarce at that price.
3.  Provide an array of 3 to 5 concise keywords (e.g., brand, item category, key features) that are relevant to the item and would be useful for starting a new search for similar items.
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

