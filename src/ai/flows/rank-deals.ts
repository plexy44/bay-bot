'use server';

/**
 * @fileOverview Ranks a list of deals based on discount percentage, relevance to the search query, price, and seller reputation.
 *
 * - rankDeals - A function that handles the deal ranking process.
 * - RankDealsInput - The input type for the rankDeals function.
 * - RankDealsOutput - The return type for the rankDeals function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const DealSchema = z.object({
  id: z.string().describe('The unique identifier of the deal.'),
  title: z.string().describe('The title of the deal.'),
  price: z.number().describe('The price of the item.'),
  discountPercentage: z.number().describe('The discount percentage of the deal.'),
  sellerReputation: z.number().describe('The reputation score of the seller.'),
  imageUrl: z.string().describe('The URL of the image for the deal.'),
});

export type Deal = z.infer<typeof DealSchema>;

const RankDealsInputSchema = z.object({
  deals: z.array(DealSchema).describe('The list of deals to rank.'),
  query: z.string().describe('The user search query.'),
});

export type RankDealsInput = z.infer<typeof RankDealsInputSchema>;

const RankDealsOutputSchema = z.array(DealSchema).describe('The ranked list of deals.');

export type RankDealsOutput = z.infer<typeof RankDealsOutputSchema>;

export async function rankDeals(input: RankDealsInput): Promise<RankDealsOutput> {
  return rankDealsFlow(input);
}

const rankDealsPrompt = ai.definePrompt({
  name: 'rankDealsPrompt',
  input: {
    schema: RankDealsInputSchema,
  },
  output: {
    schema: RankDealsOutputSchema,
  },
  prompt: `You are an expert shopping assistant. Rank the following deals based on how well they match the user's query, discount percentage, price, and seller reputation. Return the deals in an array, with the best deal first. If the deals are not related to the query, then discount percentage and seller reputation should be prioritized.

Deals:
{{#each deals}}
  - ID: {{id}}, Title: {{title}}, Price: {{price}}, Discount: {{discountPercentage}}, Seller Reputation: {{sellerReputation}}, Image URL: {{imageUrl}}
{{/each}}

User Query: {{query}}`,
});

const rankDealsFlow = ai.defineFlow(
  {
    name: 'rankDealsFlow',
    inputSchema: RankDealsInputSchema,
    outputSchema: RankDealsOutputSchema,
  },
  async input => {
    try {
      const {output} = await rankDealsPrompt(input);
      return output!;
    } catch (e) {
      console.error('Failed to rank deals, returning original list.', e);
      return input.deals;
    }
  }
);
