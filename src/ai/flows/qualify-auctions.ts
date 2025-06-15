
'use server';

/**
 * @fileOverview Qualifies and re-ranks a list of pre-filtered auctions based on credibility, potential value, relevance, and assigns a rarity score.
 * The flow asks the AI to return an array of full auction objects (AIAuction) for qualified items, including the rarity score.
 *
 * - qualifyAuctions - A function that handles the auction qualification and ranking process.
 * - QualifyAuctionsInput - The input type for the qualifyAuctions function.
 * - QualifyAuctionsOutput - The return type for the qualifyAuctions function (array of full AIAuction objects).
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import type { BayBotItem } from '@/types'; // Import BayBotItem for mapping

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
    ).optional(), // Optional because AI might not always provide it, or it's added by this flow.
});

export type AIAuction = z.infer<typeof AuctionSchema>;

const QualifyAuctionsInputSchema = z.object({
  auctions: z.array(AuctionSchema.omit({ rarityScore: true })).describe('The list of pre-filtered and server-sorted auctions to qualify and rank. Rarity score will be added by AI.'),
  query: z.string().describe('The user search query for relevance checking.'),
});

export type QualifyAuctionsInput = z.infer<typeof QualifyAuctionsInputSchema>;

const QualifyAuctionsOutputSchema = z.array(AuctionSchema).describe('The qualified and re-ranked list of auctions, including rarity scores.');
export type QualifyAuctionsOutput = z.infer<typeof QualifyAuctionsOutputSchema>;

export async function qualifyAuctions(
    baybotAuctions: BayBotItem[],
    query: string
): Promise<BayBotItem[]> {
    if (!baybotAuctions || baybotAuctions.length === 0) {
        console.log('[qualifyAuctions entry] No BayBot auctions provided to qualify. Returning empty list.');
        return [];
    }

    // Map BayBotItem to AIAuction, omitting rarityScore initially as AI will provide it
    const aiAuctionsInput: Omit<AIAuction, 'rarityScore'>[] = baybotAuctions.map(item => ({
        id: item.id,
        title: item.title,
        price: item.price, // Current bid
        sellerReputation: item.sellerReputation,
        sellerFeedbackScore: item.sellerFeedbackScore || 0,
        imageUrl: item.imageUrl,
        condition: item.condition,
        timeLeft: item.timeLeft,
        bidCount: item.bidCount,
    }));

    const flowInput: QualifyAuctionsInput = { auctions: aiAuctionsInput, query };
    
    try {
        const qualifiedAiAuctionsWithRarity: AIAuction[] = await qualifyAuctionsFlow(flowInput);
        
        const baybotAuctionMap = new Map(baybotAuctions.map(auction => [auction.id, auction]));
        
        const reorderedBaybotAuctions: BayBotItem[] = qualifiedAiAuctionsWithRarity
            .map(aiAuction => {
                const originalBaybotAuction = baybotAuctionMap.get(aiAuction.id);
                if (originalBaybotAuction) {
                    return {
                        ...originalBaybotAuction, // Spread original BayBotItem
                        rarityScore: aiAuction.rarityScore, // Add/overwrite rarityScore from AI
                    };
                }
                return null; // Should not happen if AI returns valid IDs
            })
            .filter(Boolean) as BayBotItem[];
        
        if (qualifiedAiAuctionsWithRarity.length !== baybotAuctions.length && qualifiedAiAuctionsWithRarity.length > 0) {
             console.log(`[qualifyAuctions entry] AI flow returned ${qualifiedAiAuctionsWithRarity.length} auctions out of ${baybotAuctions.length} input auctions for query "${query}".`);
        }

        return reorderedBaybotAuctions;

    } catch (e) {
        console.error(`[qualifyAuctions entry] Error calling qualifyAuctionsFlow for query "${query}". Returning original BayBot auction list. Error:`, e);
        return baybotAuctions;
    }
}


const qualifyAuctionsPrompt = ai.definePrompt({
  name: 'qualifyAndRankAuctionsWithRarityPrompt', // Renamed for clarity
  input: {
    schema: QualifyAuctionsInputSchema,
  },
  output: {
    schema: QualifyAuctionsOutputSchema, // Expecting an array of full AIAuction objects with rarity
  },
  prompt: `You are an expert shopping assistant specializing in eBay auctions. The following list of auctions has already been pre-filtered and sorted by the system (typically by ending soonest).
Your task is to QUALIFY, RE-RANK these auctions, and ASSIGN a Rarity Score (0-100) to each qualified auction.
Return an array of the full auction objects for items you deem qualified, sorted from the best auction to the worst. Each object must include all original fields plus your assigned 'rarityScore'.
If you deem no items are qualified, return an empty array.

User Query: "{{query}}"

Auctions to Qualify, Re-rank, and Score for Rarity (up to {{auctions.length}}):
{{#each auctions}}
- ID: {{id}}
  Title: "{{title}}"
  Current Bid: £{{price}}
  Seller Reputation: {{sellerReputation}}% ({{sellerFeedbackScore}} reviews)
  Condition: {{condition_or_default condition "Not specified"}}
  Time Left: {{timeLeft_or_default timeLeft "N/A"}}
  Bid Count: {{bidCount_or_default bidCount 0}}
{{/each}}

For each auction you qualify:
1.  Assess its **Rarity Score (0-100)**.
    *   **LOWER** scores (0-40) for common, easily available, mass-produced items.
    *   **MEDIUM** scores (41-70) for items that are less common, specific models, or good condition vintage.
    *   **HIGHER** scores (71-100) for genuinely hard-to-find items: vintage in excellent condition, limited editions, very specific/uncommon configurations, or exceptionally rare finds.

Consider these factors for your final ranking, qualification, and rarity scoring:
1.  **Credibility & Trust:**
    *   Prioritize sellers with high reputation (e.g., > 95%) and a significant number of feedback/reviews (e.g. > 50-100).
2.  **Potential Value & Bidding Dynamics:**
    *   Consider the current bid price relative to the item's typical market value and rarity.
3.  **Relevance to Query:**
    *   The item must be a strong match for the user's query: "{{query}}".
4.  **Time Sensitivity:**
    *   Auctions ending very soon are high priority if they represent good value.
5.  **Condition:**
    *   New or Manufacturer Refurbished items are generally preferred over Used, unless the price for Used is exceptionally good and the seller is highly reputable.
6.  **Rarity:** Use the Rarity Score criteria defined above.

Return an array of the qualified auction objects (including all original fields and your assigned 'rarityScore'), sorted from the best auction to the worst.
The array can contain fewer items than the input if some auctions are not qualified.
Example response format for 1 qualified auction:
[
  {
    "id": "id3",
    "title": "Example Item Title",
    "price": 50.00,
    "sellerReputation": 98,
    "sellerFeedbackScore": 150,
    "imageUrl": "http://example.com/image.jpg",
    "condition": "Used",
    "timeLeft": "1d 2h left",
    "bidCount": 5,
    "rarityScore": 75
  }
]
Example response format if no auctions qualified: []`,
  helpers: {
    condition_or_default: (value: string | undefined, defaultValue: string) => value || defaultValue,
    timeLeft_or_default: (value: string | undefined, defaultValue: string) => value || defaultValue,
    bidCount_or_default: (value: number | undefined, defaultValue: number) => value ?? defaultValue,
  }
});

const qualifyAuctionsFlow = ai.defineFlow(
  {
    name: 'qualifyAuctionsFlowWithRarity', // Renamed for clarity
    inputSchema: QualifyAuctionsInputSchema,
    outputSchema: QualifyAuctionsOutputSchema,
  },
  async (input: QualifyAuctionsInput): Promise<AIAuction[]> => {
    if (!input.auctions || input.auctions.length === 0) {
      console.log('[qualifyAuctionsFlowWithRarity] No auctions provided to qualify. Returning empty list.');
      return [];
    }

    try {
      const {output: qualifiedAuctionsWithRarity} = await qualifyAuctionsPrompt(input);

      if (!qualifiedAuctionsWithRarity) {
          console.warn(
          `[qualifyAuctionsFlowWithRarity] AI qualification prompt did not return a valid output (was null/undefined). Query: "${input.query}". Auctions count: ${input.auctions.length}. Falling back to original auction list order (without rarity).`
          );
          // Fallback: return original auctions but without rarity
          return input.auctions.map(auc => ({...auc, rarityScore: undefined}));
      }
      
      if (qualifiedAuctionsWithRarity.length === 0) {
        console.log(
          `[qualifyAuctionsFlowWithRarity] AI qualification prompt returned an empty list (0 qualified auctions). Query: "${input.query}". Auctions count: ${input.auctions.length}. Returning empty list from flow.`
        );
        return [];
      }

      // Validate that IDs returned by AI are from the original input set
      const originalAuctionIds = new Set(input.auctions.map(auc => auc.id));
      const validatedAuctions = qualifiedAuctionsWithRarity.filter(auc => {
        if (!originalAuctionIds.has(auc.id)) {
          console.warn(`[qualifyAuctionsFlowWithRarity] AI returned an auction with ID "${auc.id}" which was not in the original input. Discarding this item.`);
          return false;
        }
        if (typeof auc.rarityScore !== 'number' || auc.rarityScore < 0 || auc.rarityScore > 100) {
            console.warn(`[qualifyAuctionsFlowWithRarity] AI returned auction ID "${auc.id}" with invalid rarityScore: ${auc.rarityScore}. Setting to undefined.`);
            auc.rarityScore = undefined; // Or a default like 0
        }
        return true;
      });
      
      if (validatedAuctions.length !== qualifiedAuctionsWithRarity.length) {
          console.warn(`[qualifyAuctionsFlowWithRarity] Some auctions returned by AI were discarded due to invalid IDs. Original AI count: ${qualifiedAuctionsWithRarity.length}, Validated count: ${validatedAuctions.length}. Query: "${input.query}".`);
      }
      
      console.log(`[qualifyAuctionsFlowWithRarity] Successfully qualified, ranked, and scored ${validatedAuctions.length} auctions (out of ${input.auctions.length} originally provided) for query: "${input.query}".`);
      return validatedAuctions;

    } catch (e) {
      console.error(`[qualifyAuctionsFlowWithRarity] Failed to qualify auctions for query "${input.query}", returning original list (without rarity). Error:`, e);
      return input.auctions.map(auc => ({...auc, rarityScore: undefined}));
    }
  }
);
