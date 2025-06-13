
'use server';

/**
 * @fileOverview Qualifies and re-ranks a list of pre-filtered deals based on credibility, discount, relevance, seller reputation, and item rarity.
 * The flow now asks the AI to return only an array of deal IDs in ranked order, then reconstructs the full deal list.
 *
 * - rankDeals - A function that handles the deal qualification and ranking process.
 * - RankDealsInput - The input type for the rankDeals function.
 * - RankDealsOutput - The return type for the rankDeals function (still an array of full Deal objects).
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import type { BayBotItem } from '@/types'; // Import BayBotItem for mapping

const DealSchema = z.object({
  id: z.string().describe('The unique identifier of the deal.'),
  title: z.string().describe('The title of the deal.'),
  price: z.number().describe('The price of the item.'),
  originalPrice: z.number().optional().describe('The original price of the item, if available.'),
  discountPercentage: z.number().describe('The discount percentage of the deal.'),
  sellerReputation: z.number().describe('The reputation score of the seller (0-100).'),
  sellerFeedbackScore: z.number().describe('The total feedback score (number of reviews) for the seller.'),
  imageUrl: z.string().describe('The URL of the image for the deal.'),
  condition: z.string().optional().describe('The condition of the item (e.g., New, Used).'),
});

export type AIDeal = z.infer<typeof DealSchema>; // Renamed to AIDeal for clarity in this context

const RankDealsInputSchema = z.object({
  deals: z.array(DealSchema).describe('The list of pre-filtered and server-sorted deals to qualify and rank.'),
  query: z.string().describe('The user search query for relevance checking.'),
});

export type RankDealsInput = z.infer<typeof RankDealsInputSchema>;

// The output of the FLOW is still an array of full Deal objects (BayBotItem in practice)
const RankDealsOutputSchema = z.array(DealSchema).describe('The qualified and re-ranked list of deals.');
export type RankDealsOutput = z.infer<typeof RankDealsOutputSchema>;


// This function is what the client-side page will call.
// It handles the mapping from BayBotItem[] to AIDeal[] and back.
export async function rankDeals(
    baybotDeals: BayBotItem[],
    query: string
): Promise<BayBotItem[]> {
    if (!baybotDeals || baybotDeals.length === 0) {
        console.log('[rankDeals entry] No BayBot deals provided to rank. Returning empty list.');
        return [];
    }

    const aiDealsInput: AIDeal[] = baybotDeals.map(item => ({
        id: item.id,
        title: item.title,
        price: item.price,
        originalPrice: item.originalPrice,
        discountPercentage: item.discountPercentage || 0,
        sellerReputation: item.sellerReputation,
        sellerFeedbackScore: item.sellerFeedbackScore || 0,
        imageUrl: item.imageUrl,
        condition: item.condition,
    }));

    const flowInput: RankDealsInput = { deals: aiDealsInput, query };
    
    try {
        const rankedAiDeals: AIDeal[] = await rankDealsFlow(flowInput);

        if (rankedAiDeals.length !== baybotDeals.length) {
            console.warn(`[rankDeals entry] AI flow returned a different number of deals (${rankedAiDeals.length}) than input (${baybotDeals.length}). Falling back to original BayBot deal list order.`);
            return baybotDeals;
        }
        
        // Reconstruct BayBotItem[] in the new order
        const baybotDealMap = new Map(baybotDeals.map(deal => [deal.id, deal]));
        const reorderedBaybotDeals: BayBotItem[] = rankedAiDeals.map(aiDeal => baybotDealMap.get(aiDeal.id)).filter(Boolean) as BayBotItem[];

        if (reorderedBaybotDeals.length !== baybotDeals.length) {
            console.error('[rankDeals entry] Mismatch in reordered BayBotDeals length after mapping. Returning original list.');
            return baybotDeals;
        }
        return reorderedBaybotDeals;

    } catch (e) {
        console.error(`[rankDeals entry] Error calling rankDealsFlow for query "${query}". Returning original BayBot deal list. Error:`, e);
        return baybotDeals;
    }
}


// Schema for the AI Prompt's output - just an array of IDs
const RankedDealIdsOutputSchema = z.array(z.string().describe('The ID of the deal in qualified and ranked order.'));

const rankDealsPrompt = ai.definePrompt({
  name: 'qualifyAndRankDealsPrompt', 
  input: {
    schema: RankDealsInputSchema,
  },
  output: {
    schema: RankedDealIdsOutputSchema, 
  },
  prompt: `You are an expert shopping assistant. The following list of deals has already been pre-filtered and sorted by the system.
Your task is to QUALIFY and RE-RANK these deals based on overall credibility, value, and relevance to the user's query.

User Query: "{{query}}"

Deals to Qualify and Re-rank:
{{#each deals}}
- ID: {{id}}
  Title: "{{title}}"
  Price: £{{price}}
  {{#if originalPrice}}Original Price: £{{originalPrice}}{{/if}}
  Discount: {{discountPercentage}}%
  Seller Reputation: {{sellerReputation}}% ({{sellerFeedbackScore}} reviews)
  Condition: {{condition_or_default condition "Not specified"}}
{{/each}}

Consider these factors for your final ranking:
1.  **Credibility & Trust:**
    *   Prioritize sellers with high reputation (e.g., > 95%) and a significant number of feedback/reviews.
    *   Be wary of deals that seem "too good to be true" despite a high discount if other factors (low seller score, poor title, condition) are concerning.
2.  **Value (Discount & Price):**
    *   Genuine, substantial discounts are highly valued. Verify the original price makes sense if provided.
    *   Ensure the final price is competitive for the item and its condition.
3.  **Relevance to Query:**
    *   The item must be a strong match for the user's query: "{{query}}".
    *   Deprioritize items that are accessories if the main product was likely searched (e.g., if query is "laptop", a "laptop bag" is less relevant than a laptop itself, even if it's a good deal on a bag). The system has already tried to filter these, but double-check.
4.  **Item Rarity/Desirability:** (Subtle factor)
    *   A rare or highly sought-after item at a good discount might rank higher than a common item with a similar discount.

Return ONLY an array of the deal IDs, sorted from the best deal (highest credibility, value, and relevance) to the worst.
The array must contain all and only the IDs from the deals provided above.
Example response format: ["id3", "id1", "id2"]`,
  helpers: {
    condition_or_default: (value: string | undefined, defaultValue: string) => value || defaultValue,
  }
});

const rankDealsFlow = ai.defineFlow(
  {
    name: 'rankDealsFlow',
    inputSchema: RankDealsInputSchema,
    outputSchema: RankDealsOutputSchema, // Flow outputs full AIDeal objects after reordering
  },
  async (input: RankDealsInput): Promise<AIDeal[]> => { // Changed output type to AIDeal[]
    if (!input.deals || input.deals.length === 0) {
      console.log('[rankDealsFlow] No deals provided to rank. Returning empty list.');
      return [];
    }

    try {
      const {output: rankedIds} = await rankDealsPrompt(input);

      if (!rankedIds || rankedIds.length === 0) {
          console.warn(
          `[rankDealsFlow] AI ranking (IDs) prompt returned no output. Query: "${input.query}". Deals count: ${input.deals.length}. Returning original deal list order.`
          );
          return input.deals; 
      }
      
      if (rankedIds.length !== input.deals.length) {
        console.warn(
          `[rankDealsFlow] AI ranking (IDs) prompt returned a list with an unexpected number of IDs. Input deals count: ${input.deals.length}, Output IDs count: ${rankedIds.length}. Query: "${input.query}". Returning original deal list order.`
        );
        // To ensure all original deals are present, even if AI fails to rank all, we could attempt a partial sort
        // or simply return the original list if safety is paramount. For now, return original.
        return input.deals; 
      }

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
        return input.deals; 
      }

      const dealMap = new Map(input.deals.map(deal => [deal.id, deal]));
      const reorderedDeals: AIDeal[] = rankedIds.map(id => dealMap.get(id)).filter(Boolean) as AIDeal[];
      
      if (reorderedDeals.length !== input.deals.length) {
          console.error('[rankDealsFlow] Mismatch in reorderedDeals length after mapping. This indicates a logic flaw. Returning original list.');
          return input.deals;
      }
      
      console.log(`[rankDealsFlow] Successfully reordered ${reorderedDeals.length} deals based on AI-qualified and ranked IDs for query: "${input.query}".`);
      return reorderedDeals;

    } catch (e) {
      console.error(`[rankDealsFlow] Failed to rank deals for query "${input.query}", returning original list. Error:`, e);
      return input.deals; 
    }
  }
);
