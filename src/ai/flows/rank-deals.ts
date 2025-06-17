
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
  name: 'curateAndSortItemsPromptV4', // Incremented version due to significant logic change
  input: {
    schema: RankDealsInputSchema,
  },
  output: {
    schema: RankDealsOutputSchema, 
  },
  prompt: `You are an eBay deals sorting and filtering engine.
Input: User Search Query: "{{query}}", Item List (up to {{items.length}} items):
{{#each items}}
- ID: {{id}}
  Title: "{{title}}"
  Price: £{{price}}
  {{#if originalPrice}}Original Price: £{{originalPrice}}{{/if}}
  Discount: {{discountPercentage}}%
  Seller Reputation: {{sellerReputation}}% ({{sellerFeedbackScore}} reviews)
  Condition: {{condition_or_default condition "Not specified"}}
{{/each}}

Output: Sorted and filtered JSON array of items.

RULES:

{{#eq viewType "Deals"}}
1.  INITIAL FILTERING (Strict - Apply First):
    a.  RELEVANCE:
        -   If User Search Query ("{{query}}") is specific (e.g., "iPhone 15", "Nike Air Max 90"): Item title MUST closely match. Vague matches are DISCARDED.
        -   If User Search Query ("{{query}}") is broad (e.g., "laptop", "shoes"): Item MUST clearly be of that category.
    b.  ACCESSORY ELIMINATION (for Main Product Queries):
        -   If User Search Query ("{{query}}") is for a main product (e.g., "iPhone", "Macbook", "PS5 console"): AGGRESSIVELY DISCARD accessories (cases, chargers, screen protectors, cables, empty boxes, stands, bags, straps, manuals), even if the accessory mentions the main product. ONLY THE CORE PRODUCT IS VALID.
        -   If User Search Query ("{{query}}") IS for an accessory (e.g., "iPhone 15 case", "laptop charger"): Accessories ARE VALID.
    c.  SCAM & LOW-QUALITY ELIMINATION:
        -   DISCARD items with titles/descriptions indicating: "box only", "empty box", "for parts", "not working", "damaged", "spares or repair", "read description" (if it implies issues and is not a query for such items).
        -   DISCARD items with absurdly low prices for the product type (e.g., new flagship phone for £1). These are likely accessories, scams, or mislistings.

2.  PRIMARY SORTING (Apply to ALL items that passed Step 1):
    -   Sort items STRICTLY in DESCENDING order by \`discountPercentage\`.
    -   Highest \`discountPercentage\` comes FIRST.
    -   Items with no discount (0% or missing original price data) go to the VERY BOTTOM, after all discounted items.

3.  SECONDARY SORTING (TIE-BREAKING ONLY for items with IDENTICAL \`discountPercentage\`):
    -   If \`discountPercentage\` is the same, then prefer:
        1.  Stronger keyword relevance to User Search Query ("{{query}}").
        2.  Higher \`sellerReputation\` and \`sellerFeedbackScore\`.
{{/eq}}

{{#eq viewType "Auctions"}}
Your goal is to find interesting and relevant auctions that the user can participate in for the User Search Query: "{{query}}".

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
-   Use the exact original item JSON structure and fields.
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
Example response format for Auctions (shows 1 qualified auction):
[
  {
    "id": "id_auction1",
    "title": "Example Auction Title",
    "price": 50.00,
    "sellerReputation": 98,
    "sellerFeedbackScore": 150,
    "imageUrl": "http://example.com/auction_image.jpg",
    "condition": "Used",
    "timeLeft": "1d 2h left",
    "bidCount": 5,
    "rarityScore": 75
  }
]
Example response format if no items deemed suitable: []
`,
  helpers: {
    condition_or_default: (value: string | undefined, defaultValue: string): string => value || defaultValue,
    timeLeft_or_default: (value: string | undefined, defaultValue: string): string => value || defaultValue, 
    bidCount_or_default: (value: number | undefined, defaultValue: number): number => value ?? defaultValue, 
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
