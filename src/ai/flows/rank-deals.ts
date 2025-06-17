
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
            // Return empty if AI explicitly says so
            return [];
        }
        
        const dealscopeDealMap = new Map(dealscopeDeals.map(deal => [deal.id, deal]));
        
        const uniqueRankedAiDealsMap = new Map<string, AIDeal>();
        rankedAiDeals.forEach(aiDeal => {
            if (dealscopeDealMap.has(aiDeal.id)) { // Ensure AI returned valid, original items
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
                    // The AI returns AIDeal which should have all necessary fields.
                    // We merge to retain any DealScopeItem specific fields not in AIDeal, if any.
                    // And to ensure the returned objects are full DealScopeItem instances from the original list.
                    return {
                        ...originalDeal, // Start with original to preserve all its properties
                        ...aiDeal,       // Overlay with AI's version (which should be identical in structure for AIDeal)
                    };
                }
                return null;
            })
            .filter(Boolean) as DealScopeItem[];
        
        return reorderedDealScopeDeals;

    } catch (e) {
        console.error(`[rankDeals entry] Error calling rankDealsFlow for query "${query}". Returning original DealScope deal list as fallback. Error:`, e);
        return dealscopeDeals; // Fallback to original, unsorted list
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
  prompt: `You are an expert e-commerce curator with a deep understanding of the eBay marketplace. Your primary function is to intelligently sort and filter a provided list of items to create the most valuable and relevant view for the user. You must be precise, always aiming to provide a useful selection.

You will be given three pieces of information:

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

Based on the View Type, follow the corresponding logic below.

{{#eq viewType "Deals"}}
Your goal is to find the best-value items with the highest discounts that are DIRECTLY RELEVANT to the user's query.

Initial Filter (The Great Filter): First, review the entire list and identify items that are highly irrelevant to the "{{query}}" or likely scams.

Keyword Relevance: When the query is for a specific product (e.g., "Apple iPhone" when user searched "Apple iPhone"), you must aggressively filter out irrelevant accessories like cases, screen protectors, chargers, or empty boxes. The user wants the core product, not its peripherals. If the query is for an accessory (e.g., "iPhone case"), then accessories are relevant. Apply this filtering strictly for all items.

Price Sanity Check: If an item's price seems absurdly low for the product type (e.g., a new iPhone for £10), it is likely a scam or an accessory. These should be considered extremely low quality and filtered out.

Strict Primary Sorting by Discount: After completing the 'Initial Filter', 'Keyword Relevance' filtering, and 'Price Sanity Check' steps, you MUST sort the remaining qualified items. Your **ABSOLUTE AND OVERRIDING PRIMARY SORTING KEY** is \`discountPercentage\`, in strictly DESCENDING order. An item with a 50% discount MUST appear before an item with a 49% discount if both are deemed relevant by the preceding filters.

Secondary Sorting (Only for Identical Discounts): ONLY IF two or more relevant items have the EXACT SAME \`discountPercentage\`, should you then use 'Keyword Relevance' (closer match to query is better) and then 'Seller Reputation' (higher is better) as tie-breakers.

Handling a Vague Search: If the query is broad (e.g., "phone", "laptop"), be more inclusive in what is considered relevant for the 'Keyword Relevance' step. However, the 'Strict Primary Sorting by Discount' rule still applies to the items deemed relevant. Your priority is still to find discounted items, but you should focus on items from legitimate, reputable sellers, even if the brand wasn't specified.

Final Placement for Non-Discounted Items: Items that passed initial filters but have NO \`discountPercentage\` (or 0%) MUST be placed at the very bottom of the sorted list, after all items with a positive discount.
{{/eq}}

Mandatory Final Instruction:

After applying the logic, you must return the entire, re-ordered list of items in the exact original JSON format, matching the schema of the input items. Do not add, remove, or alter any fields in the JSON objects beyond what the schema allows. Do not add any text, explanation, or summary. Your only output is the complete, sorted JSON array of qualified items. If no items are qualified, return an empty array.
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
Example if no items qualified: []`,
  helpers: {
    condition_or_default: (value: string | undefined, defaultValue: string): string => value || defaultValue,
    eq: (arg1, arg2) => arg1 === arg2,
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
          return input.items; // Fallback to original items in original order
      }

      // Validate that AI didn't introduce new items or malformed items
      const originalDealIds = new Set(input.items.map(deal => deal.id));
      const validatedDeals = rankedFullDeals.filter(deal => {
        if (!originalDealIds.has(deal.id)) {
          console.warn(`[rankDealsFlow] AI returned deal with ID "${deal.id}" which was not in the original input. Discarding.`);
          return false;
        }
        // Add more validation if necessary (e.g., all required fields present)
        return true;
      });
      
      if (validatedDeals.length !== rankedFullDeals.length) {
          console.warn(`[rankDealsFlow] Some deals from AI were discarded due to ID mismatch. Original AI count: ${rankedFullDeals.length}, Validated: ${validatedDeals.length}. Query: "${input.query}".`);
      }
       // Ensure uniqueness in the final list from AI, preferring the order AI provided
      const uniqueValidatedDealsMap = new Map<string, AIDeal>();
      validatedDeals.forEach(deal => {
          if (!uniqueValidatedDealsMap.has(deal.id)) {
              uniqueValidatedDealsMap.set(deal.id, deal);
          }
      });

      return Array.from(uniqueValidatedDealsMap.values());

    } catch (e) {
      console.error(`[rankDealsFlow] Failed to rank deals for query "${input.query}", returning original list. Error:`, e);
      return input.items; // Fallback to original items in original order
    }
  }
);
    
