
'use server';

/**
 * @fileOverview Ranks a list of deals based on discount percentage, relevance to the search query, price, and seller reputation.
 * The flow now asks the AI to return only an array of deal IDs in ranked order, then reconstructs the full deal list.
 *
 * - rankDeals - A function that handles the deal ranking process.
 * - RankDealsInput - The input type for the rankDeals function.
 * - RankDealsOutput - The return type for the rankDeals function (still an array of full Deal objects).
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

// The output of the FLOW is still an array of full Deal objects
const RankDealsOutputSchema = z.array(DealSchema).describe('The ranked list of deals.');
export type RankDealsOutput = z.infer<typeof RankDealsOutputSchema>;

export async function rankDeals(input: RankDealsInput): Promise<RankDealsOutput> {
  return rankDealsFlow(input);
}

// Schema for the AI Prompt's output - just an array of IDs
const RankedDealIdsOutputSchema = z.array(z.string().describe('The ID of the deal in ranked order.'));

const rankDealsPrompt = ai.definePrompt({
  name: 'rankDealsPromptForIDs', // Updated name for clarity
  input: {
    schema: RankDealsInputSchema,
  },
  output: {
    schema: RankedDealIdsOutputSchema, // AI outputs an array of IDs
  },
  prompt: `You are an expert shopping assistant. Review the following deals carefully.
Rank them based on how well they match the user's query, their discount percentage, price, and seller reputation.
Consider all factors to provide the best possible ranking for the user.
If a deal seems unrelated to the query, deprioritize it but still include its ID in the ranked list.

Deals:
{{#each deals}}
- ID: {{id}}, Title: {{title}}, Price: {{price}}, Discount: {{discountPercentage}}%, Seller Reputation: {{sellerReputation}}%
{{/each}}

User Query: {{query}}

Return ONLY an array of the deal IDs, sorted from the best deal to the worst deal. The array must contain all and only the IDs from the deals provided above.
Example response format: ["id3", "id1", "id2"]`,
});

const rankDealsFlow = ai.defineFlow(
  {
    name: 'rankDealsFlow',
    inputSchema: RankDealsInputSchema,
    outputSchema: RankDealsOutputSchema, // Flow still outputs full deals
  },
  async (input: RankDealsInput): Promise<RankDealsOutput> => {
    if (!input.deals || input.deals.length === 0) {
      console.log('[rankDealsFlow] No deals provided to rank. Returning empty list.');
      return [];
    }

    try {
      const {output: rankedIds} = await rankDealsPrompt(input);

      if (!rankedIds || rankedIds.length !== input.deals.length) {
        console.warn(
          `[rankDealsFlow] AI ranking (IDs) prompt returned no output, or a list with an unexpected number of IDs. Input deals count: ${input.deals.length}, Output IDs count: ${rankedIds?.length ?? 0}. Query: "${input.query}". Returning original deal list order.`
        );
        return input.deals; // Return original reference
      }

      // Verify all original IDs are present in the ranked IDs and there are no duplicates or extras
      const originalIdsSet = new Set(input.deals.map(d => d.id));
      const outputIdsSet = new Set(rankedIds);

      if (rankedIds.length !== outputIdsSet.size) {
        console.warn(
          `[rankDealsFlow] AI ranking (IDs) output contained duplicate IDs. Input deals count: ${input.deals.length}, Unique output IDs count: ${outputIdsSet.size}. Query: "${input.query}". Returning original deal list order.`
        );
        return input.deals;
      }
      
      if (originalIdsSet.size !== outputIdsSet.size || !Array.from(originalIdsSet).every(id => outputIdsSet.has(id))) {
        console.warn(
          `[rankDealsFlow] AI ranking (IDs) output did not contain the exact same set of IDs as input. Input IDs count: ${originalIdsSet.size}, Output IDs count: ${outputIdsSet.size}. Some IDs might be missing or new ones added. Query: "${input.query}". Returning original deal list order.`
        );
        return input.deals; // Return original reference
      }

      // Reconstruct the AIDeal array in the new order
      const dealMap = new Map(input.deals.map(deal => [deal.id, deal]));
      const reorderedDeals: AIDeal[] = rankedIds.map(id => dealMap.get(id)).filter(Boolean) as AIDeal[];

      // Final check, though theoretically covered by above checks
      if (reorderedDeals.length !== input.deals.length) {
          console.error('[rankDealsFlow] Mismatch in reorderedDeals length after mapping, despite ID set checks passing. This indicates a logic flaw. Returning original list.');
          return input.deals;
      }
      
      console.log(`[rankDealsFlow] Successfully reordered ${reorderedDeals.length} deals based on AI-ranked IDs for query: "${input.query}".`);
      return reorderedDeals; // Return NEW, reordered array of full AIDeal objects

    } catch (e) {
      console.error(`[rankDealsFlow] Failed to rank deals for query "${input.query}", returning original list. Error:`, e);
      return input.deals; // Return original reference
    }
  }
);
