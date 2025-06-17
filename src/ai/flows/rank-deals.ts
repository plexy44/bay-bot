
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
  name: 'curateAndSortItemsPromptV3',
  input: {
    schema: RankDealsInputSchema,
  },
  output: {
    schema: RankDealsOutputSchema, 
  },
  prompt: `You are an expert e-commerce curator with a deep understanding of the eBay marketplace. Your primary function is to intelligently sort and filter a provided list of items to create the most valuable and relevant view for the user. You must be precise but not overly strict, always aiming to provide a useful selection.

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
Your goal is to find the best-value items with the highest discounts for the User Search Query: "{{query}}".
You will execute the following steps in this exact order:

🔍 Step 1: Relevance Filtering (The Great Filter)
Apply these filters IN ORDER before any sorting:
  1.1 Strict Keyword Matching:
      Only include items that directly relate to the user's Search Query: "{{query}}".
      If the query contains a specific brand or model (e.g., "iPhone"), you MUST AGGRESSIVELY exclude accessories (cases, chargers, screen protectors, empty boxes, etc.) unless the query ITSELF is for an accessory. The user wants the core product.
      If the query is vague (e.g., "phone"), be slightly more inclusive but still prioritize full products over accessories.
  1.2 Scam Filtering - Price Sanity:
      If an item's price seems absurdly low for the product type given the query (e.g., a new iPhone for £10), exclude it as likely a scam or an irrelevant accessory listing. Consider these extremely low quality.

📊 Step 2: MANDATORY Primary Sorting by Discount Percentage (Highest First)
After completing ALL filtering in Step 1, you MUST sort the remaining qualified items.
The **ONLY** primary sorting key for these relevant, filtered items is \`discountPercentage\`.
You MUST sort these items in **STRICTLY DESCENDING ORDER** of \`discountPercentage\`.
An item with a 50% discount MUST appear before an item with a 49% discount. An item with a 49% discount MUST appear before an item with a 48% discount, and so on. There are NO exceptions to this primary sorting rule for items with a positive discount.

⚖️ Step 3: Secondary Ranking (Tie-Breaking ONLY for Identical Discounts)
ONLY IF two or more relevant items have the EXACT SAME \`discountPercentage\` after Step 2, should you then use the following criteria, in order, as tie-breakers:
  3.1 Keyword Relevance: An item that is an exact match for the user's query ("{{query}}") is more valuable than a partial match.
  3.2 Seller Quality: Prefer sellers with higher \`sellerReputation\` and \`sellerFeedbackScore\`.

📉 Step 4: Final Placement for Non-Discounted Items
Items that passed all filters in Step 1 but have NO \`discountPercentage\` (i.e., \`discountPercentage\` is 0 or not present) MUST be placed at the very bottom of the sorted list, AFTER all items with a positive \`discountPercentage\` have been listed in their correct descending discount order as per Step 2 and 3.
{{/eq}}

{{#eq viewType "Auctions"}}
Your goal is to find interesting and relevant auctions that the user can participate in for the User Search Query: "{{query}}".

Initial Filter & Relevance:
Keyword Relevance: Items that are a strong match for the user's query "{{query}}" should be prioritized. Filter out accessories like cases, chargers, etc., if the query is for a main product (e.g., "vintage Omega watch"). If the query is for an accessory (e.g. "watch strap"), then accessories are relevant.
Seller Credibility: Consider items from sellers with reasonable \`sellerReputation\` and \`sellerFeedbackScore\`. Avoid sellers with critically low scores unless the item is exceptionally rare and clearly described.

Primary Sorting: Your primary sorting logic is soonest to end. Auctions ending in the near future are more urgent and valuable.

Secondary Sorting & Ranking: For items ending at similar times, apply this logic:
  1. Keyword Relevance: Stronger matches for "{{query}}" are preferred.
  2. Potential Value & Bidding Dynamics: Consider current \`price\`, \`bidCount\`.
  3. Seller Reputation.
  4. Condition.

Rarity Assessment: For each auction you include, assign a \`rarityScore\` (0-100). Lower scores (0-40) for common items, medium (41-70) for less common or good condition vintage, higher (71-100) for genuinely hard-to-find items (vintage, limited edition, very specific configurations, or truly exceptional short-lived deals on popular items making them scarce at that price).

Minimum Viable List: Your goal is to present a healthy list of at least 16 auctions. If your initial quality filtering results in fewer than 16 items, you should be less strict and include more auctions that are a reasonable match for the user's query, even if they end further in the future. Ensure you still assign a \`rarityScore\` to all included items.
{{/eq}}

Mandatory Final Instruction:

After applying the logic for the given "{{viewType}}", you must return the entire, re-ordered list of items in the exact original JSON format, matching the schema of the items (including the 'rarityScore' for auctions if applicable). Do not add, remove, or alter any fields in the JSON objects beyond what the schema allows. Do not add any text, explanation, or summary. Your only output is the complete, sorted JSON array of qualified items. If no items are qualified, return an empty array: [].
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

❗Final Reminder:
You must always:
1.  {{#eq viewType "Deals"}}**CRITICALLY AND ABSOLUTELY: After relevance filtering (Step 1), return relevant deals sorted with the HIGHEST \`discountPercentage\` FIRST (Step 2). This is the most important instruction for sorting. Items with lower discounts or no discount MUST appear after items with higher discounts.**{{/eq}}
    {{#eq viewType "Auctions"}}**CRITICALLY: After relevance filtering, return relevant auctions sorted primarily by ending soonest, then by other auction-specific criteria. Assign \`rarityScore\` to all included auctions.**{{/eq}}
2.  Show only relevant and trustworthy listings based on Step 1 filters (for Deals) or Initial Filter & Relevance (for Auctions).
3.  Never hallucinate, fabricate, or guess any data or fields.
4.  Work strictly within the data provided in the 'Item List'.
5.  Return only the sorted JSON array of item objects in the exact original format, containing all original fields plus your assigned \`rarityScore\` if applicable (for auctions). Do not add any other text, explanation, or summary. If no items are qualified, return an empty array: [].
`,
  helpers: {
    condition_or_default: (value: string | undefined, defaultValue: string): string => value || defaultValue,
    timeLeft_or_default: (value: string | undefined, defaultValue: string): string => value || defaultValue, // Kept for auctions
    bidCount_or_default: (value: number | undefined, defaultValue: number): number => value ?? defaultValue, // Kept for auctions
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
    

    
