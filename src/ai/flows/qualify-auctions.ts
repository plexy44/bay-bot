
'use server';

/**
 * @fileOverview Qualifies and re-ranks a list of pre-filtered auctions based on a comprehensive AI prompt.
 * The flow asks the AI to return an array of full auction objects (AIAuction) for qualified items, including a rarity score.
 *
 * - qualifyAuctions - A function that handles the auction qualification and ranking process.
 * - QualifyAuctionsInput - The input type for the qualifyAuctions function.
 * - QualifyAuctionsOutput - The return type for the qualifyAuctions function (array of full AIAuction objects).
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import type { DealScopeItem } from '@/types';

const AuctionSchema = z.object({
  id: z.string().describe('The unique identifier of the auction.'),
  title: z.string().describe('The title of the auction item.'),
  price: z.number().describe('The current bid price of the item.'),
  sellerReputation: z.number().describe('The reputation score of the seller (0-100).'),
  sellerFeedbackScore: z.number().describe('The total feedback score (number of reviews) for the seller.'),
  imageUrl: z.string().describe('The URL of the image for the auction item.'),
  condition: z.string().optional().describe('The condition of the item (e.g., New, Used).'),
  timeLeft: z.string().optional().describe('Human-readable time left for the auction (e.g., "2d 5h left", "Ending soon").'),
  bidCount: z.number().optional().describe('The number of bids on the auction.'),
  rarityScore: z
    .number()
    .min(0)
    .max(100)
    .describe(
      'A score from 0-100 indicating item rarity. Lower for common, mass-produced. Higher for vintage, limited editions, specific configurations, or exceptional deals on popular items making them scarce at that price.'
    ).optional(),
});

export type AIAuction = z.infer<typeof AuctionSchema>;

const QualifyAuctionsInputSchema = z.object({
  viewType: z.literal('Auctions').describe('Indicates that the processing is for auctions.'),
  items: z.array(AuctionSchema.omit({ rarityScore: true })).describe('The list of pre-filtered auctions to qualify, rank, and for which rarity should be scored.'),
  query: z.string().describe('The user search query for relevance checking.'),
});

export type QualifyAuctionsInput = z.infer<typeof QualifyAuctionsInputSchema>;

const QualifyAuctionsOutputSchema = z.array(AuctionSchema).describe('The qualified and re-ranked list of auctions, including rarity scores.');
export type QualifyAuctionsOutput = z.infer<typeof QualifyAuctionsOutputSchema>;

export async function qualifyAuctions(
    dealscopeAuctions: DealScopeItem[],
    query: string
): Promise<DealScopeItem[]> {
    if (!dealscopeAuctions || dealscopeAuctions.length === 0) {
        return [];
    }

    const aiAuctionsInput: Omit<AIAuction, 'rarityScore'>[] = dealscopeAuctions.map(item => ({
        id: item.id,
        title: item.title,
        price: item.price,
        sellerReputation: item.sellerReputation,
        sellerFeedbackScore: item.sellerFeedbackScore || 0,
        imageUrl: item.imageUrl,
        condition: item.condition,
        timeLeft: item.timeLeft,
        bidCount: item.bidCount,
    }));

    const flowInput: QualifyAuctionsInput = { viewType: 'Auctions', items: aiAuctionsInput, query };

    try {
        const qualifiedAiAuctionsWithRarityOutput: AIAuction[] = await qualifyAuctionsFlow(flowInput);
        
        if (qualifiedAiAuctionsWithRarityOutput.length === 0 && dealscopeAuctions.length > 0) {
            console.warn(`[qualifyAuctions entry] AI flow returned 0 qualified auctions for query "${query}" from ${dealscopeAuctions.length} inputs. The page will show NO AI-qualified auctions as AI explicitly returned empty.`);
            return []; 
        }

        const dealscopeAuctionMap = new Map(dealscopeAuctions.map(auction => [auction.id, auction]));

        const uniqueQualifiedAIAuctionsMap = new Map<string, AIAuction>();
        qualifiedAiAuctionsWithRarityOutput.forEach(aiAuction => {
            if (dealscopeAuctionMap.has(aiAuction.id)) { 
                if (!uniqueQualifiedAIAuctionsMap.has(aiAuction.id)) {
                    uniqueQualifiedAIAuctionsMap.set(aiAuction.id, aiAuction);
                }
            } else {
                 console.warn(`[qualifyAuctions entry] AI returned an auction ID "${aiAuction.id}" not present in the original input for query "${query}". Discarding.`);
            }
        });
        const uniqueQualifiedAIAuctions = Array.from(uniqueQualifiedAIAuctionsMap.values());

        const reorderedDealScopeAuctions: DealScopeItem[] = uniqueQualifiedAIAuctions
            .map(aiAuction => {
                const originalDealScopeAuction = dealscopeAuctionMap.get(aiAuction.id);
                if (originalDealScopeAuction) {
                    return {
                        ...originalDealScopeAuction, 
                        ...aiAuction, 
                        rarityScore: aiAuction.rarityScore, 
                    };
                }
                return null;
            })
            .filter(Boolean) as DealScopeItem[];
        
        return reorderedDealScopeAuctions;

    } catch (e) {
        console.error(`[qualifyAuctions entry] Error calling qualifyAuctionsFlow for query "${query}". Returning original DealScope auction list as fallback (no AI rarity scores). Error:`, e);
        return dealscopeAuctions.map(auc => ({ ...auc, rarityScore: undefined })); 
    }
}


const qualifyAuctionsPrompt = ai.definePrompt({
  name: 'curateAndSortItemsPromptAuctionsV2', // Incremented version
  input: {
    schema: QualifyAuctionsInputSchema,
  },
  output: {
    schema: QualifyAuctionsOutputSchema,
  },
  prompt: `You are an expert e-commerce curator with a deep understanding of the eBay marketplace. Your primary function is to intelligently sort and filter a provided list of items to create the most valuable and relevant view for the user.

You will be given:
View Type: "{{viewType}}"
User Search Query: "{{query}}"
Item List (up to {{items.length}} items):
{{#each items}}
- ID: {{id}}
  Title: "{{title}}"
  Current Bid: £{{price}}
  Seller Reputation: {{sellerReputation}}% ({{sellerFeedbackScore}} reviews)
  Condition: {{condition_or_default condition "Not specified"}}
  Time Left: {{timeLeft_or_default timeLeft "N/A"}}
  Bid Count: {{bidCount_or_default bidCount 0}}
{{/each}}

Output: Sorted and filtered JSON array of items.

RULES:

{{#eq viewType "Auctions"}}
Your goal is to find interesting and relevant auctions.

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

MANDATORY OUTPUT:
-   Return ONLY the sorted JSON array of items.
-   Use the exact original item JSON structure and fields (including \`rarityScore\` for auctions).
-   NO commentary, NO summaries, NO explanations.
-   If no items pass filters, return an empty array: [].
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
`,
  helpers: {
    condition_or_default: (value: string | undefined, defaultValue: string): string => value || defaultValue,
    timeLeft_or_default: (value: string | undefined, defaultValue: string): string => value || defaultValue,
    bidCount_or_default: (value: number | undefined, defaultValue: number): number => value ?? defaultValue,
    eq: (arg1, arg2) => arg1 === arg2,
  }
});

const qualifyAuctionsFlow = ai.defineFlow(
  {
    name: 'qualifyAuctionsFlowWithFullObjectReturn',
    inputSchema: QualifyAuctionsInputSchema,
    outputSchema: QualifyAuctionsOutputSchema,
  },
  async (input: QualifyAuctionsInput): Promise<AIAuction[]> => {
    if (!input.items || input.items.length === 0) {
      return [];
    }

    try {
      const {output: qualifiedAuctionsWithRarity} = await qualifyAuctionsPrompt(input);

      if (!qualifiedAuctionsWithRarity) {
          console.warn(
          `[qualifyAuctionsFlow] AI prompt returned null/undefined. Query: "${input.query}". Input count: ${input.items.length}. Falling back to original list (no rarity).`
          );
          return input.items.map(auc => ({...auc, rarityScore: undefined, price: auc.price || 0 }));
      }

      if (qualifiedAuctionsWithRarity.length === 0 && input.items.length > 0) {
         console.info(`[qualifyAuctionsFlow] AI returned 0 auctions for query "${input.query}" from ${input.items.length} inputs. This is an explicit AI decision.`);
        return []; 
      }
      
      const originalAuctionIds = new Set(input.items.map(auc => auc.id));
      const validatedAuctions = qualifiedAuctionsWithRarity.filter(auc => {
        if (!originalAuctionIds.has(auc.id)) {
          console.warn(`[qualifyAuctionsFlow] AI returned auction ID "${auc.id}" not in original input. Discarding.`);
          return false;
        }
        if (typeof auc.rarityScore !== 'number' || auc.rarityScore < 0 || auc.rarityScore > 100) {
            console.warn(`[qualifyAuctionsFlow] AI returned auction ID "${auc.id}" with invalid rarityScore: ${auc.rarityScore}. Setting to undefined.`);
            auc.rarityScore = undefined; 
        }
        return true;
      });

      if (validatedAuctions.length !== qualifiedAuctionsWithRarity.length) {
          console.warn(`[qualifyAuctionsFlow] Some auctions from AI were discarded (invalid ID or rarity). Original AI count: ${qualifiedAuctionsWithRarity.length}, Validated: ${validatedAuctions.length}. Query: "${input.query}".`);
      }
      
      const uniqueValidatedAuctionsMap = new Map<string, AIAuction>();
      validatedAuctions.forEach(auc => {
        if (!uniqueValidatedAuctionsMap.has(auc.id)) { 
            uniqueValidatedAuctionsMap.set(auc.id, auc);
        }
      });

      return Array.from(uniqueValidatedAuctionsMap.values());

    } catch (e) {
      console.error(`[qualifyAuctionsFlow] CRITICAL FAILURE for query "${input.query}", returning original list (no rarity). Error:`, e);
      return input.items.map(auc => ({...auc, rarityScore: undefined, price: auc.price || 0 }));
    }
  }
);
