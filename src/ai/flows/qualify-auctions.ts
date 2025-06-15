
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
    ).optional(),
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
        // console.log('[qualifyAuctions entry] No BayBot auctions provided to qualify. Returning empty list.');
        return [];
    }

    const aiAuctionsInput: Omit<AIAuction, 'rarityScore'>[] = baybotAuctions.map(item => ({
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

    const flowInput: QualifyAuctionsInput = { auctions: aiAuctionsInput, query };

    try {
        const qualifiedAiAuctionsWithRarity: AIAuction[] = await qualifyAuctionsFlow(flowInput);

        const baybotAuctionMap = new Map(baybotAuctions.map(auction => [auction.id, auction]));

        const reorderedBaybotAuctions: BayBotItem[] = qualifiedAiAuctionsWithRarity
            .map(aiAuction => {
                const originalBaybotAuction = baybotAuctionMap.get(aiAuction.id);
                if (originalBaybotAuction) {
                    return {
                        ...originalBaybotAuction,
                        rarityScore: aiAuction.rarityScore, // Rarity score comes from AI
                    };
                }
                return null;
            })
            .filter(Boolean) as BayBotItem[];

        if (reorderedBaybotAuctions.length === 0 && baybotAuctions.length > 0 && qualifiedAiAuctionsWithRarity.length === 0) {
             console.warn(`[qualifyAuctions entry] AI flow returned 0 qualified auctions for query "${query}" from ${baybotAuctions.length} inputs. The page will show NO AI-qualified auctions as AI explicitly returned empty. Input count: ${aiAuctionsInput.length}, AI output count: ${qualifiedAiAuctionsWithRarity.length}`);
        } else if (reorderedBaybotAuctions.length < baybotAuctions.length && reorderedBaybotAuctions.length > 0) {
             // console.log(`[qualifyAuctions entry] AI flow returned ${reorderedBaybotAuctions.length} qualified BayBot auctions out of ${baybotAuctions.length} input auctions for query "${query}".`);
        }

        return reorderedBaybotAuctions; // This will be empty if AI returned empty and no fallback was triggered

    } catch (e) {
        console.error(`[qualifyAuctions entry] Error calling qualifyAuctionsFlow for query "${query}". Returning original BayBot auction list as fallback. Error:`, e);
        // Fallback to original list on error, without AI rarity scores
        return baybotAuctions.map(auc => ({ ...auc, rarityScore: undefined }));
    }
}


const qualifyAuctionsPrompt = ai.definePrompt({
  name: 'qualifyAndRankAuctionsWithRarityPrompt',
  input: {
    schema: QualifyAuctionsInputSchema,
  },
  output: {
    schema: QualifyAuctionsOutputSchema,
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
    name: 'qualifyAuctionsFlowWithRarity',
    inputSchema: QualifyAuctionsInputSchema,
    outputSchema: QualifyAuctionsOutputSchema,
  },
  async (input: QualifyAuctionsInput): Promise<AIAuction[]> => {
    if (!input.auctions || input.auctions.length === 0) {
      // console.log('[qualifyAuctionsFlow] No auctions provided to qualify. Returning empty list.');
      return [];
    }

    try {
      const {output: qualifiedAuctionsWithRarity} = await qualifyAuctionsPrompt(input);

      if (!qualifiedAuctionsWithRarity) { // AI prompt failed or returned null/undefined
          console.warn(
          `[qualifyAuctionsFlow] AI prompt returned null/undefined. Query: "${input.query}". Input count: ${input.auctions.length}. Falling back to original list (no rarity).`
          );
          // Fallback: return original items without rarity if AI prompt fails
          return input.auctions.map(auc => ({...auc, rarityScore: undefined}));
      }

      // If AI explicitly returns an empty array, it means it qualified 0 items.
      if (qualifiedAuctionsWithRarity.length === 0 && input.auctions.length > 0) {
        console.warn(
          `[qualifyAuctionsFlow] AI prompt returned an empty list (0 qualified auctions) from ${input.auctions.length} inputs. Query: "${input.query}". Returning original items (no rarity) as a fallback.`
        );
        // Fallback: if AI explicitly returns [], but we had items, return original items without rarity
        return input.auctions.map(auc => ({...auc, rarityScore: undefined}));
      }
      if (qualifiedAuctionsWithRarity.length === 0 && input.auctions.length === 0) {
         // console.log(`[qualifyAuctionsFlow] AI prompt received 0 input auctions and returned 0. Query: "${input.query}".`);
        return [];
      }

      // Validate AI output: ensure IDs are from the original input and rarityScore is valid
      const originalAuctionIds = new Set(input.auctions.map(auc => auc.id));
      const validatedAuctions = qualifiedAuctionsWithRarity.filter(auc => {
        if (!originalAuctionIds.has(auc.id)) {
          console.warn(`[qualifyAuctionsFlow] AI returned auction ID "${auc.id}" not in original input. Discarding.`);
          return false;
        }
        if (typeof auc.rarityScore !== 'number' || auc.rarityScore < 0 || auc.rarityScore > 100) {
            console.warn(`[qualifyAuctionsFlow] AI returned auction ID "${auc.id}" with invalid rarityScore: ${auc.rarityScore}. Setting to undefined.`);
            auc.rarityScore = undefined; // Correct invalid rarity score
        }
        return true;
      });

      if (validatedAuctions.length !== qualifiedAuctionsWithRarity.length) {
          console.warn(`[qualifyAuctionsFlow] Some auctions from AI were discarded (invalid ID or rarity). Original AI count: ${qualifiedAuctionsWithRarity.length}, Validated: ${validatedAuctions.length}. Query: "${input.query}".`);
      }

      // console.log(`[qualifyAuctionsFlow] Successfully qualified, ranked, and scored ${validatedAuctions.length} auctions (out of ${input.auctions.length} inputs) for query: "${input.query}".`);
      return validatedAuctions;

    } catch (e) {
      console.error(`[qualifyAuctionsFlow] CRITICAL FAILURE for query "${input.query}", returning original list (no rarity). Error:`, e);
      // Critical fallback: return original items without rarity
      return input.auctions.map(auc => ({...auc, rarityScore: undefined}));
    }
  }
);
