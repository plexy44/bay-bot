
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
  query: z.string().describe('The user search query for relevance checking. If this is "general curated deals" or similar, treat as a general curation task. If it is a specific user query, prioritize direct relevance to that query string.'),
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
        
        // Reconstruct BayBotItem[] in the new order from AI.
        // If rankedAiDeals is a subset, this will correctly map only those.
        const baybotDealMap = new Map(baybotDeals.map(deal => [deal.id, deal]));
        const reorderedBaybotDeals: BayBotItem[] = rankedAiDeals
            .map(aiDeal => baybotDealMap.get(aiDeal.id))
            .filter(Boolean) as BayBotItem[];

        // Log if the AI returned a different number of items than it was given
        if (rankedAiDeals.length !== baybotDeals.length && rankedAiDeals.length > 0) { // Added rankedAiDeals.length > 0 to avoid logging for empty returns
             console.log(`[rankDeals entry] AI flow returned ${rankedAiDeals.length} deals out of ${baybotDeals.length} input deals for query "${query}". Client will handle fallbacks if needed.`);
        }
        
        return reorderedBaybotDeals; // This could be a subset of original baybotDeals

    } catch (e) {
        console.error(`[rankDeals entry] Error calling rankDealsFlow for query "${query}". Returning original BayBot deal list as fallback. Error:`, e);
        return baybotDeals; // Fallback to original full list on error
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
Your task is to QUALIFY and RE-RANK these deals based on overall credibility, value, and relevance.
Return ONLY an array of the deal IDs for items you deem qualified, sorted from the best deal to the worst.
If you deem no items are qualified, return an empty array.

User Query: "{{query}}"
{{#if query_is_specific query}}
IMPORTANT: The user has provided a specific query: "{{query}}". Prioritize items that are an EXACT or VERY STRONG match to this query above all other factors. If an item is not highly relevant to this specific query, it should be ranked very low or not qualified, even if it's a good deal otherwise.
{{else}}
The user query indicates a general curation request. Focus on overall deal quality, discount, and seller credibility.
{{/if}}

Deals to Qualify and Re-rank (up to {{deals.length}}):
{{#each deals}}
- ID: {{id}}
  Title: "{{title}}"
  Price: £{{price}}
  {{#if originalPrice}}Original Price: £{{originalPrice}}{{/if}}
  Discount: {{discountPercentage}}%
  Seller Reputation: {{sellerReputation}}% ({{sellerFeedbackScore}} reviews)
  Condition: {{condition_or_default condition "Not specified"}}
{{/each}}

Consider these factors for your final ranking and qualification:
1.  **Relevance to Query:**
    *   {{#if query_is_specific query}}
        **CRITICAL FOR THIS TASK:** The item MUST be a strong, direct match for the user's query: "{{query}}". Items that are vaguely related or accessories (unless the query is FOR an accessory) should be disqualified or ranked very low.
        {{else}}
        The item must be a strong match for the user's query: "{{query}}". Deprioritize items that are accessories if the main product was likely searched.
        {{/if}}
2.  **Credibility & Trust:**
    *   Prioritize sellers with high reputation (e.g., > 95%) and a significant number of feedback/reviews (e.g. > 50-100).
    *   Be wary of deals that seem "too good to be true" despite a high discount if other factors (low seller score, poor title, condition) are concerning.
3.  **Value (Discount & Price):**
    *   Genuine, substantial discounts (e.g. > 10-15%) are highly valued. Verify the original price makes sense if provided.
    *   Ensure the final price is competitive for the item and its condition.
4.  **Item Rarity/Desirability:** (Subtle factor, less important if query is specific)
    *   A rare or highly sought-after item at a good discount might rank higher than a common item with a similar discount.
5.  **Condition:**
    *   New or Manufacturer Refurbished items are generally preferred over Used, unless the price for Used is exceptionally good and the seller is highly reputable.

Return ONLY an array of the deal IDs that you qualify, sorted from the best deal (highest credibility, best potential value, and relevance) to the worst.
The array can contain fewer IDs than the input if some deals are not qualified.
Example response format for 3 qualified deals: ["id3", "id1", "id2"]
Example response format if no deals qualified: []`,
  helpers: {
    condition_or_default: (value: string | undefined, defaultValue: string) => value || defaultValue,
    query_is_specific: (query: string) => {
      const genericTerms = ["general curated deals", "curated deals", "deals", "general deals", "top deals", "best deals", "general curated deals background cache from auctions", "general curated deals top-up/soft refresh"]; // Add more generic phrases if needed
      return query && !genericTerms.some(term => query.toLowerCase().includes(term.toLowerCase()));
    }
  }
});

const rankDealsFlow = ai.defineFlow(
  {
    name: 'rankDealsFlow',
    inputSchema: RankDealsInputSchema,
    outputSchema: RankDealsOutputSchema, // Flow outputs full AIDeal objects after reordering
  },
  async (input: RankDealsInput): Promise<AIDeal[]> => { 
    if (!input.deals || input.deals.length === 0) {
      console.log('[rankDealsFlow] No deals provided to rank. Returning empty list.');
      return [];
    }

    try {
      const {output: rankedIds} = await rankDealsPrompt(input);

      if (!rankedIds) { // Prompt failed or returned null/undefined
          console.warn(
          `[rankDealsFlow] AI ranking (IDs) prompt did not return a valid output (was null/undefined). Query: "${input.query}". Deals count: ${input.deals.length}. Falling back to original deal list order.`
          );
          return input.deals; // Fallback to full original list if AI prompt fails badly
      }
      
      if (rankedIds.length === 0) {
        console.log(
          `[rankDealsFlow] AI ranking (IDs) prompt returned an empty list (0 qualified deals). Query: "${input.query}". Deals count: ${input.deals.length}. Returning empty list from flow.`
        );
        return []; // AI explicitly said no deals are qualified
      }

      // Validate for duplicate IDs in AI output
      const outputIdsSet = new Set(rankedIds);
      if (rankedIds.length !== outputIdsSet.size) {
        console.warn(
          `[rankDealsFlow] AI ranking (IDs) output contained duplicate IDs. Unique output IDs count: ${outputIdsSet.size}, Total output IDs: ${rankedIds.length}. Query: "${input.query}". Falling back to original deal list order.`
        );
        return input.deals;
      }
      
      const dealMap = new Map(input.deals.map(deal => [deal.id, deal]));
      // Construct the list based on AI's ranked IDs, filtering out any IDs AI might have hallucinated (not in original input)
      const reorderedDeals: AIDeal[] = rankedIds
        .map(id => dealMap.get(id))
        .filter(Boolean) as AIDeal[];
      
      if (reorderedDeals.length !== rankedIds.length) {
          console.warn(`[rankDealsFlow] AI returned ${rankedIds.length} IDs, but only ${reorderedDeals.length} could be mapped to original deals. Some IDs might have been hallucinated. Query: "${input.query}". Proceeding with mapped deals.`);
      }
      
      console.log(`[rankDealsFlow] AI qualified and reordered ${reorderedDeals.length} deals (out of ${input.deals.length} originally provided) for query: "${input.query}".`);
      return reorderedDeals;

    } catch (e) {
      console.error(`[rankDealsFlow] Failed to rank deals for query "${input.query}", returning original list. Error:`, e);
      return input.deals; // Fallback to full original list on critical error
    }
  }
);

