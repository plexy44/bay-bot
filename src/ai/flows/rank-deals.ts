
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
  viewType: z.enum(['Deals', 'Auctions']).describe('Indicates that the processing is for deals or auctions.'),
  items: z.array(DealSchema).describe('The list of pre-filtered deals/auctions to qualify and rank.'),
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
  name: 'curateAndSortItemsV7',
  input: {
    schema: RankDealsInputSchema,
  },
  output: {
    schema: RankDealsOutputSchema, 
  },
  prompt: `You are an expert e-commerce curator with a deep understanding of the eBay marketplace. Your primary function is to intelligently sort and filter a provided list of items to create the most valuable and relevant view for the user. You must be precise and follow the rules strictly.

You will be given:
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
  {{#if timeLeft}}Time Left: {{timeLeft}}{{/if}}
  {{#if bidCount}}Bid Count: {{bidCount}}{{/if}}
{{/each}}

Based on the View Type, follow the corresponding logic below.

{{#eq viewType "Deals"}}
Your goal is to find the best-value items that are highly relevant to the user's query, with the highest discounts displayed first.

You will perform the following steps in THIS EXACT SEQUENCE:

PART A: HARD FILTERING
Apply these filters to the 'Item List' to REMOVE ALL non-compliant items. Only items passing ALL these checks proceed to Part B.
1.  STRICT KEYWORD RELEVANCE to User Search Query ("{{query}}"):
    -   Items MUST be a strong, direct match to "{{query}}".
    -   ACCESSORY ELIMINATION: If "{{query}}" is for a main product (e.g., "iPhone 15", "laptop"), you MUST DISCARD all accessories (cases, chargers, screen protectors, cables, empty boxes, stands, bags, straps, manuals, etc.), even if they mention the main product. ONLY THE CORE PRODUCT IS VALID.
    -   EXCEPTION: If "{{query}}" IS for an accessory (e.g., "iPhone 15 case", "laptop charger"), then accessories ARE RELEVANT.
2.  SCAM & IRRELEVANT CONTENT ELIMINATION:
    -   DISCARD listings indicating: "box only", "empty box", "for parts", "not working", "damaged", "spares or repair".
    -   DISCARD listings with absurdly low prices for the product type (e.g., a new iPhone for £1), as these are likely scams or miscategorized accessories.

PART B: MANDATORY SORTING of Filtered Items
Take ALL items that PASSED Part A. You will now sort THIS FILTERED LIST.
1.  **ABSOLUTE PRIMARY SORT RULE: \`discountPercentage\` (Highest to Lowest)**
    -   You MUST sort the filtered items STRICTLY and SOLELY by their \`discountPercentage\` field in DESCENDING order.
    -   An item with a \`discountPercentage\` of 80% MUST be listed before an item with 68%.
    -   An item with a \`discountPercentage\` of 68% MUST be listed before an item with 25%.
    -   An item with a \`discountPercentage\` of 25% MUST be listed before an item with 6%.
    -   This rule is PARAMOUNT. NO OTHER FACTOR OVERRIDES THIS for items with positive discounts.
2.  TIE-BREAKING (ONLY for items with IDENTICAL \`discountPercentage\`):
    -   If, AND ONLY IF, two or more items have the EXACT SAME \`discountPercentage\`, then use these secondary criteria IN ORDER to break the tie:
        a.  Stronger keyword relevance to User Search Query ("{{query}}").
        b.  Higher \`sellerReputation\` and \`sellerFeedbackScore\`.
3.  PLACEMENT OF ITEMS WITH ZERO OR NO DISCOUNT:
    -   Any items that passed Part A filters but have a \`discountPercentage\` of 0 (or no \`discountPercentage\` data) MUST be placed at the VERY BOTTOM of the final list, AFTER all items with positive discounts have been sorted according to the rules above.
{{/eq}}

{{#eq viewType "Auctions"}}
Your goal is to find interesting and relevant auctions for the User Search Query: "{{query}}".

INITIAL FILTERING (Apply Before Sorting):
1.  RELEVANCE TO QUERY ("{{query}}"):
    -   If query is specific (e.g., "vintage Omega watch"): Item MUST be a strong match. Discard completely unrelated items.
    -   ACCESSORIES: If query is for a main product, filter out accessories (straps, boxes for a watch query) unless the query *is* for an accessory.
2.  CRITICAL SELLER CHECK: Consider sellers with very low reputation/feedback only if the item is exceptionally rare and clearly described. Generally, prefer credible sellers.
3.  OBVIOUS SCAMS/MISLISTINGS: Discard items clearly stating "box only", "for parts" (if not a parts query), or with prices that are nonsensical for an auction starting bid.

PRIMARY SORTING: SOONEST TO END.

SECONDARY SORTING & RANKING (for items ending at similar times):
1.  Keyword Relevance to "{{query}}".
2.  Potential Value (current \`price\`, \`bidCount\`).
3.  Seller Reputation & Feedback Score.
4.  Item \`condition\`.

RARITY ASSESSMENT: Assign \`rarityScore\` (0-100) to ALL INCLUDED auctions. Lower scores (0-40) for common items, medium (41-70) for less common or good condition vintage, higher (71-100) for genuinely hard-to-find items (vintage, limited editions, very specific configurations, or truly exceptional short-lived deals on popular items making them scarce at that price).

MINIMUM LIST SIZE: Aim for AT LEAST 16 relevant auctions. If filters result in fewer, be more inclusive on relevance if the item is at least tangentially related to "{{query}}" and not a scam, especially if it ends further in the future. Prioritize showing a reasonable selection.
{{/eq}}

MANDATORY OUTPUT:
-   Return ONLY the sorted JSON array of items.
-   Use the exact original item JSON structure and fields (including \`rarityScore\` for auctions if \`viewType\` is "Auctions").
-   NO commentary, NO summaries, NO explanations.
-   If no items pass filters, return an empty array: [].
Example response format for Deals (shows 2 qualified deals, sorted by discount):
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
Example response format if no items deemed suitable: []

❗Final Reminder:
1.  For "Deals", after performing the HARD FILTERING in Part A, your MOST IMPORTANT task is the MANDATORY SORTING in Part B.
2.  **THE ABSOLUTE PRIMARY SORT RULE for "Deals" is \`discountPercentage\` in DESCENDING order. This is not optional and overrides all other considerations for items with different positive discounts.**
3.  You are re-ordering and filtering the provided 'Item List'. Do not add, remove, or alter fields in the original JSON objects, except for \`rarityScore\` when processing "Auctions".
4.  Output ONLY the sorted JSON array. No commentary. If no items pass filters, return an empty array: [].
`,
  helpers: {
    condition_or_default: (value: string | undefined, defaultValue: string): string => value || defaultValue,
    timeLeft_or_default: (value: string | undefined, defaultValue: string): string => value || defaultValue, 
    bidCount_or_default: (value: number | undefined, defaultValue: number): number => value ?? defaultValue, 
    eq: (arg1: string, arg2: string) => arg1 === arg2,
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
          // Fallback to sorting by discount client-side if AI fails, to at least attempt the primary rule.
          return input.items.sort((a, b) => (b.discountPercentage || 0) - (a.discountPercentage || 0));
      }

      const originalDealIds = new Set(input.items.map(deal => deal.id));
      const validatedDeals = rankedFullDeals.filter(deal => {
        if (!originalDealIds.has(deal.id)) {
          console.warn(`[rankDealsFlow] AI returned deal with ID "${deal.id}" which was not in the original input. Discarding.`);
          return false;
        }
        // Ensure discountPercentage is a number, default to 0 if missing/invalid for safety, though AI should return it.
        if (typeof deal.discountPercentage !== 'number') {
            deal.discountPercentage = 0;
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

      // Final check to ensure AI adhered to sorting, primarily for debugging.
      // The AI is expected to return the items already sorted.
      const aiSortedList = Array.from(uniqueValidatedDealsMap.values());
      // For debugging:
      // const isCorrectlySorted = aiSortedList.every((item, index, arr) => {
      //   if (index === 0) return true;
      //   return (item.discountPercentage || 0) <= (arr[index - 1].discountPercentage || 0);
      // });
      // if (!isCorrectlySorted) {
      //   console.warn(`[rankDealsFlow] AI may not have sorted correctly by discountPercentage for query "${input.query}". First few discounts:`, aiSortedList.slice(0, 5).map(d => d.discountPercentage));
      // }
      return aiSortedList;

    } catch (e) {
      console.error(`[rankDealsFlow] Failed to rank deals for query "${input.query}", returning original list sorted by discount. Error:`, e);
      // Fallback to sorting by discount client-side if AI fails
      return input.items.sort((a, b) => (b.discountPercentage || 0) - (a.discountPercentage || 0));
    }
  }
);

