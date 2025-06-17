
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
import type { DealScopeItem } from '@/types';

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

export type AIDeal = z.infer<typeof DealSchema>;

const RankDealsInputSchema = z.object({
  deals: z.array(DealSchema).describe('The list of pre-filtered and server-sorted deals to qualify and rank.'),
  query: z.string().describe('The user search query for relevance checking. If this is "general curated deals" or similar, treat as a general curation task. If it is a specific user query, prioritize direct relevance to that query string.'),
});

export type RankDealsInput = z.infer<typeof RankDealsInputSchema>;

const RankDealsOutputSchema = z.array(DealSchema).describe('The qualified and re-ranked list of deals.');
export type RankDealsOutput = z.infer<typeof RankDealsOutputSchema>;


export async function rankDeals(
    dealscopeDeals: DealScopeItem[],
    query: string
): Promise<DealScopeItem[]> {
    if (!dealscopeDeals || dealscopeDeals.length === 0) {
        return [];
    }

    const aiDealsInput: AIDeal[] = dealscopeDeals.map(item => ({
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

        const dealscopeDealMap = new Map(dealscopeDeals.map(deal => [deal.id, deal]));
        
        const uniqueRankedAiDealsMap = new Map<string, AIDeal>();
        rankedAiDeals.forEach(aiDeal => {
            if (!uniqueRankedAiDealsMap.has(aiDeal.id)) {
                uniqueRankedAiDealsMap.set(aiDeal.id, aiDeal);
            }
        });
        const uniqueRankedAiDeals = Array.from(uniqueRankedAiDealsMap.values());

        const reorderedDealScopeDeals: DealScopeItem[] = uniqueRankedAiDeals
            .map(aiDeal => dealscopeDealMap.get(aiDeal.id))
            .filter(Boolean) as DealScopeItem[];

        if (rankedAiDeals.length === 0 && dealscopeDeals.length > 0) {
            console.warn(`[rankDeals entry] AI flow returned 0 qualified deals for query "${query}" from ${dealscopeDeals.length} inputs.`);
        }

        return reorderedDealScopeDeals;

    } catch (e) {
        console.error(`[rankDeals entry] Error calling rankDealsFlow for query "${query}". Returning original DealScope deal list as fallback. Error:`, e);
        return dealscopeDeals;
    }
}


const RankedDealIdsOutputSchema = z.array(z.string().describe('The ID of the deal in qualified and ranked order.'));

const rankDealsPrompt = ai.definePrompt({
  name: 'qualifyAndRankDealsPrompt',
  input: {
    schema: RankDealsInputSchema,
  },
  output: {
    schema: RankedDealIdsOutputSchema,
  },
  prompt: `You are an expert shopping assistant specializing in finding the best deals.
The following list of deals has been pre-filtered by the system.
Your task is to return ONLY an array of the deal IDs for items you deem qualified, sorted from the best deal to the worst.
If you deem no items are qualified, return an empty array.

User Query: "{{query}}"

{{#if query_is_specific query}}
CRITICAL INSTRUCTIONS FOR SPECIFIC USER QUERY: "{{query}}"
Your task is to return ONLY the IDs of deals that are an EXACT or VERY STRONG match to "{{query}}".
THEN, from these exact/strong matches, you MUST rank them primarily by the HIGHEST GENUINE DISCOUNT PERCENTAGE.
This is the ranking hierarchy you MUST follow for specific queries:
1.  **Exact/Very Strong Relevance to "{{query}}":** This is a non-negotiable filter. If it's not a direct match, DISCARD IT.
    *   **Accessory Filtering:** Crucially, if "{{query}}" is for a main product (e.g., 'iPhone 15 Pro', 'Dell XPS 15', 'Sony A7 IV camera'), you MUST DISCARD all listings that are only accessories (e.g., phone cases, screen protectors, laptop bags, camera lenses unless the query *is* for a lens). If the query IS for an accessory (e.g., 'iPhone 15 Pro case'), then accessories are relevant. For broad specific queries like "laptops" or "TVs", ensure the item is indeed a laptop or TV, not a minor part or accessory.
2.  **Highest Genuine Discount Percentage:** Among the directly relevant items, sort them with the highest discount percentage first. A 50% off relevant item is better than a 10% off relevant item. A 20% discount is very good.
3.  **Seller Credibility & Trust:** For items with similar relevance and discount, prefer sellers with higher reputation (>95%) and more feedback.
4.  **Item Condition:** Prefer New or Manufacturer Refurbished over Used, unless the Used item has a significantly better discount AND high seller credibility.
5.  **Price Competitiveness:** Ensure the final price is reasonable for the item, its condition, and discount.
(Item Rarity is less important for specific searches focused on deals unless it's an exceptionally rare item *also* at a good discount).
{{else}}
INSTRUCTIONS FOR GENERAL CURATION (Query: "{{query}}")
Focus on overall deal quality, significant discounts, and seller credibility. Be mindful of not including accessories if the general intent suggests a main product category. Rank by a balance of these factors.
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

Return ONLY an array of the deal IDs that you qualify, sorted from the best deal to the worst based on the criteria above.
The array can contain fewer IDs than the input if some deals are not qualified.
Example response format for 3 qualified deals: ["id3", "id1", "id2"]
Example response format if no deals qualified: []`,
  helpers: {
    condition_or_default: (value: string | undefined, defaultValue: string): string => value || defaultValue,
    query_is_specific: (query: string) => {
      const qLower = query.toLowerCase();
      const systemQueryPatterns = [
        "general curated deal", 
        "background cache",
        "top-up/soft refresh"
      ];
      const simpleGenericTerms = ["deals", "offers", "discounts", "sale"];

      if (!query || qLower.trim().length < 3) return false; 

      if (systemQueryPatterns.some(pattern => qLower.includes(pattern))) {
        return false;
      }
      if (simpleGenericTerms.includes(qLower)) {
        return false;
      }
      if (qLower.endsWith(" initial") || qLower.endsWith(" more")) {
          const baseQuery = qLower.replace(" initial", "").replace(" more", "");
          if (systemQueryPatterns.some(pattern => baseQuery.includes(pattern))) {
              return false;
          }
      }
      return true; 
    }
  }
});

const rankDealsFlow = ai.defineFlow(
  {
    name: 'rankDealsFlow',
    inputSchema: RankDealsInputSchema,
    outputSchema: RankDealsOutputSchema,
  },
  async (input: RankDealsInput): Promise<AIDeal[]> => {
    if (!input.deals || input.deals.length === 0) {
      return [];
    }

    try {
      const {output: rankedIds} = await rankDealsPrompt(input);

      if (!rankedIds) {
          console.warn(
          `[rankDealsFlow] AI ranking (IDs) prompt returned null/undefined. Query: "${input.query}". Deals count: ${input.deals.length}. Falling back to original deal list order.`
          );
          return input.deals;
      }

      if (rankedIds.length === 0) {
        return [];
      }

      const outputIdsSet = new Set(rankedIds);
      if (rankedIds.length !== outputIdsSet.size) {
        console.warn(
          `[rankDealsFlow] AI ranking (IDs) output contained duplicate IDs. Query: "${input.query}". Falling back to original deal list order.`
        );
        return input.deals;
      }

      const dealMap = new Map(input.deals.map(deal => [deal.id, deal]));
      const reorderedDeals: AIDeal[] = rankedIds
        .map(id => dealMap.get(id))
        .filter(Boolean) as AIDeal[];

      if (reorderedDeals.length !== rankedIds.length) {
          console.warn(`[rankDealsFlow] AI returned ${rankedIds.length} IDs, but only ${reorderedDeals.length} mapped to original deals. Query: "${input.query}".`);
      }

      return reorderedDeals;

    } catch (e) {
      console.error(`[rankDealsFlow] Failed to rank deals for query "${input.query}", returning original list. Error:`, e);
      return input.deals;
    }
  }
);
