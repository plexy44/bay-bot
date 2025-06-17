
'use server';

/**
 * @fileOverview Qualifies and re-ranks a list of pre-filtered deals based on a comprehensive AI prompt.
 * The AI is expected to return the full list of qualified and sorted deal objects.
 *
 * - rankDeals - A function that handles the deal qualification and ranking process.
 * - RankDealsInput - The input type for the rankDeals function.
 * - RankDealsOutput - The return type for the rankDeals function (array of full Deal objects).
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
  viewType: z.literal('Deals').describe('Indicates that the processing is for deals.'),
  items: z.array(DealSchema).describe('The list of pre-filtered deals to qualify and rank.'),
  query: z.string().describe('The user search query for relevance checking.'),
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

    const flowInput: RankDealsInput = { viewType: 'Deals', items: aiDealsInput, query };

    try {
        const rankedAiDeals: AIDeal[] = await rankDealsFlow(flowInput);

        if (rankedAiDeals.length === 0 && dealscopeDeals.length > 0) {
            console.warn(`[rankDeals entry] AI flow returned 0 qualified deals for query "${query}" from ${dealscopeDeals.length} inputs.`);
            return [];
        }
        
        const dealscopeDealMap = new Map(dealscopeDeals.map(deal => [deal.id, deal]));
        
        const uniqueRankedAiDealsMap = new Map<string, AIDeal>();
        rankedAiDeals.forEach(aiDeal => {
            if (dealscopeDealMap.has(aiDeal.id)) { 
                 if (!uniqueRankedAiDealsMap.has(aiDeal.id)) {
                    uniqueRankedAiDealsMap.set(aiDeal.id, aiDeal);
                }
            } else {
                console.warn(`[rankDeals entry] AI returned a deal ID "${aiDeal.id}" not present in the original input for query "${query}". Discarding.`);
            }
        });
        const uniqueRankedAiDeals = Array.from(uniqueRankedAiDealsMap.values());

        const reorderedDealScopeDeals: DealScopeItem[] = uniqueRankedAiDeals
            .map(aiDeal => {
                const originalDeal = dealscopeDealMap.get(aiDeal.id);
                if (originalDeal) {
                    return {
                        ...originalDeal, 
                        ...aiDeal,       
                    };
                }
                return null;
            })
            .filter(Boolean) as DealScopeItem[];
        
        return reorderedDealScopeDeals;

    } catch (e) {
        console.error(`[rankDeals entry] Error calling rankDealsFlow for query "${query}". Returning original DealScope deal list as fallback. Error:`, e);
        return dealscopeDeals; 
    }
}

const rankDealsPrompt = ai.definePrompt({
  name: 'curateAndSortItemsPromptDeals',
  input: {
    schema: RankDealsInputSchema,
  },
  output: {
    schema: RankDealsOutputSchema, 
  },
  prompt: `You are an expert e-commerce curator specializing in the eBay marketplace. Your core function is to rank and filter a given list of eBay items for the user. Your primary goal is to display the best-value deals first based strictly on percentage discount, while filtering out irrelevant or low-quality results.

You will be provided with:

View Type: "{{viewType}}"
User Search Query: "{{query}}"
Item List (up to {{items.length}} items):
{{#each items}}
- ID: {{id}}
  Title: "{{title}}"
  Price: £{{price}}
  {{#if originalPrice}}Original Price: £{{originalPrice}}{{/if}}
  Discount: {{discountPercentage}}%
  Seller Reputation: {{sellerReputation}}% ({{sellerFeedbackScore}} reviews)
  Condition: {{condition_or_default condition "Not specified"}}
{{/each}}

Your Mission: Curate and return a fully sorted and filtered version of the item list based only on the available data.

Step 1: Relevance Filtering (The Great Filter)
Apply these filters before sorting:

Strict Keyword Matching:
Only include items that directly relate to the user's intent.
If the query contains a specific brand or model (e.g., "iPhone"), you must exclude accessories (cases, chargers, screen protectors, empty boxes).
If the query is vague (e.g., "phone"), be slightly more inclusive but prioritize full products over accessories.

Scam Filtering - Price Sanity:
If a listing's price is suspiciously low for the product category (e.g., £10 for a new iPhone), exclude it as likely a scam or an irrelevant listing.

Step 2: Sorting by Discount
Your primary sorting rule is highest percentage discount first.
Use the item's original and current price to calculate: percentage_off = ((original_price - current_price) / original_price) * 100
Items with a higher percentage off must always appear first.
If some items have no percentage discount or no original price data, they must be placed at the very bottom of the list.

Step 3: Secondary Ranking (Only if percentages are equal)
For items with equal discount percentage, use the following order of preference:
1. Keyword Relevance: Exact query matches are ranked higher.
2. Seller Quality: Prefer sellers with higher feedback ratings.

Output Format (Strict)
Return only the sorted JSON array, with no added or removed fields.
Do not include any commentary, logs, or summaries.
Output must be a valid JSON array of items, in the exact format received.

Example response format for 2 qualified deals:
[
  {
    "id": "id_high_discount_relevant",
    "title": "Relevant Item A with High Discount",
    "price": 50.00,
    "originalPrice": 100.00,
    "discountPercentage": 50,
    "sellerReputation": 98,
    "sellerFeedbackScore": 1500,
    "imageUrl": "http://example.com/image_a.jpg",
    "condition": "New"
  },
  {
    "id": "id_low_discount_relevant",
    "title": "Relevant Item B with Lower Discount",
    "price": 80.00,
    "originalPrice": 100.00,
    "discountPercentage": 20,
    "sellerReputation": 99,
    "sellerFeedbackScore": 500,
    "imageUrl": "http://example.com/image_b.jpg",
    "condition": "New"
  }
]
Example if no items qualified: []

Final Reminder:
You must always:
- Return deals with the highest percentage off first.
- Show only relevant and trustworthy listings.
- Never hallucinate, fabricate, or guess any data or fields.
- Work strictly within the data provided by the eBay API.
`,
  helpers: {
    condition_or_default: (value: string | undefined, defaultValue: string): string => value || defaultValue,
    eq: (arg1, arg2) => arg1 === arg2, // Retained for potential future use if prompt logic evolves
  }
});

const rankDealsFlow = ai.defineFlow(
  {
    name: 'rankDealsFlowWithFullObjectReturn',
    inputSchema: RankDealsInputSchema,
    outputSchema: RankDealsOutputSchema, 
  },
  async (input: RankDealsInput): Promise<AIDeal[]> => {
    if (!input.items || input.items.length === 0) {
      return [];
    }

    try {
      const {output: rankedFullDeals} = await rankDealsPrompt(input);

      if (!rankedFullDeals) {
          console.warn(
          `[rankDealsFlow] AI ranking (full objects) prompt returned null/undefined. Query: "${input.query}". Deals count: ${input.items.length}. Falling back to original deal list order.`
          );
          return input.items; 
      }

      const originalDealIds = new Set(input.items.map(deal => deal.id));
      const validatedDeals = rankedFullDeals.filter(deal => {
        if (!originalDealIds.has(deal.id)) {
          console.warn(`[rankDealsFlow] AI returned deal with ID "${deal.id}" which was not in the original input. Discarding.`);
          return false;
        }
        return true;
      });
      
      if (validatedDeals.length !== rankedFullDeals.length) {
          console.warn(`[rankDealsFlow] Some deals from AI were discarded due to ID mismatch. Original AI count: ${rankedFullDeals.length}, Validated: ${validatedDeals.length}. Query: "${input.query}".`);
      }
      const uniqueValidatedDealsMap = new Map<string, AIDeal>();
      validatedDeals.forEach(deal => {
          if (!uniqueValidatedDealsMap.has(deal.id)) {
              uniqueValidatedDealsMap.set(deal.id, deal);
          }
      });

      return Array.from(uniqueValidatedDealsMap.values());

    } catch (e) {
      console.error(`[rankDealsFlow] Failed to rank deals for query "${input.query}", returning original list. Error:`, e);
      return input.items; 
    }
  }
);
    

    