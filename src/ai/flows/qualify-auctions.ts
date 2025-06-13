
'use server';

/**
 * @fileOverview Qualifies and re-ranks a list of pre-filtered auctions based on credibility, potential value, and relevance.
 * The flow asks the AI to return only an array of auction IDs in ranked order, then reconstructs the full auction list.
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
});

export type AIAuction = z.infer<typeof AuctionSchema>;

const QualifyAuctionsInputSchema = z.object({
  auctions: z.array(AuctionSchema).describe('The list of pre-filtered and server-sorted auctions to qualify and rank.'),
  query: z.string().describe('The user search query for relevance checking.'),
});

export type QualifyAuctionsInput = z.infer<typeof QualifyAuctionsInputSchema>;

const QualifyAuctionsOutputSchema = z.array(AuctionSchema).describe('The qualified and re-ranked list of auctions.');
export type QualifyAuctionsOutput = z.infer<typeof QualifyAuctionsOutputSchema>;

// This function is what the client-side page will call.
// It handles the mapping from BayBotItem[] to AIAuction[] and back.
export async function qualifyAuctions(
    baybotAuctions: BayBotItem[],
    query: string
): Promise<BayBotItem[]> {
    if (!baybotAuctions || baybotAuctions.length === 0) {
        console.log('[qualifyAuctions entry] No BayBot auctions provided to qualify. Returning empty list.');
        return [];
    }

    const aiAuctionsInput: AIAuction[] = baybotAuctions.map(item => ({
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
        const qualifiedAiAuctions: AIAuction[] = await qualifyAuctionsFlow(flowInput);

        if (qualifiedAiAuctions.length !== baybotAuctions.length) {
            console.warn(`[qualifyAuctions entry] AI flow returned a different number of auctions (${qualifiedAiAuctions.length}) than input (${baybotAuctions.length}). Falling back to original BayBot auction list order.`);
            return baybotAuctions;
        }
        
        const baybotAuctionMap = new Map(baybotAuctions.map(auction => [auction.id, auction]));
        const reorderedBaybotAuctions: BayBotItem[] = qualifiedAiAuctions.map(aiAuction => baybotAuctionMap.get(aiAuction.id)).filter(Boolean) as BayBotItem[];

        if (reorderedBaybotAuctions.length !== baybotAuctions.length) {
            console.error('[qualifyAuctions entry] Mismatch in reordered BayBotAuctions length after mapping. Returning original list.');
            return baybotAuctions;
        }
        return reorderedBaybotAuctions;

    } catch (e) {
        console.error(`[qualifyAuctions entry] Error calling qualifyAuctionsFlow for query "${query}". Returning original BayBot auction list. Error:`, e);
        return baybotAuctions;
    }
}

const RankedAuctionIdsOutputSchema = z.array(z.string().describe('The ID of the auction in qualified and ranked order.'));

const qualifyAuctionsPrompt = ai.definePrompt({
  name: 'qualifyAndRankAuctionsPrompt',
  input: {
    schema: QualifyAuctionsInputSchema,
  },
  output: {
    schema: RankedAuctionIdsOutputSchema,
  },
  prompt: `You are an expert shopping assistant specializing in eBay auctions. The following list of auctions has already been pre-filtered and sorted by the system (typically by ending soonest).
Your task is to QUALIFY and RE-RANK these auctions based on overall credibility, potential value, and relevance to the user's query.

User Query: "{{query}}"

Auctions to Qualify and Re-rank:
{{#each auctions}}
- ID: {{id}}
  Title: "{{title}}"
  Current Bid: £{{price}}
  Seller Reputation: {{sellerReputation}}% ({{sellerFeedbackScore}} reviews)
  Condition: {{condition_or_default condition "Not specified"}}
  Time Left: {{timeLeft_or_default timeLeft "N/A"}}
  Bid Count: {{bidCount_or_default bidCount 0}}
{{/each}}

Consider these factors for your final ranking:
1.  **Credibility & Trust:**
    *   Prioritize sellers with high reputation (e.g., > 95%) and a significant number of feedback/reviews.
    *   Be wary of items with unusually low starting bids if other factors (low seller score, poor title, vague condition) are concerning.
2.  **Potential Value & Bidding Dynamics:**
    *   Consider the current bid price relative to the item's typical market value.
    *   A low bid count on a desirable item ending soon might be a good opportunity.
    *   A high bid count might indicate strong competition and potentially a higher final price.
3.  **Relevance to Query:**
    *   The item must be a strong match for the user's query: "{{query}}".
    *   Deprioritize items that are accessories if the main product was likely searched. The system has already tried to filter these, but double-check.
4.  **Time Sensitivity:**
    *   Auctions ending very soon are high priority if they represent good value. Balance this with other factors.

Return ONLY an array of the auction IDs, sorted from the best auction (highest credibility, best potential value, and relevance) to the worst.
The array must contain all and only the IDs from the auctions provided above.
Example response format: ["id3", "id1", "id2"]`,
  helpers: {
    condition_or_default: (value: string | undefined, defaultValue: string) => value || defaultValue,
    timeLeft_or_default: (value: string | undefined, defaultValue: string) => value || defaultValue,
    bidCount_or_default: (value: number | undefined, defaultValue: number) => value ?? defaultValue,
  }
});

const qualifyAuctionsFlow = ai.defineFlow(
  {
    name: 'qualifyAuctionsFlow',
    inputSchema: QualifyAuctionsInputSchema,
    outputSchema: QualifyAuctionsOutputSchema, // Flow outputs full AIAuction objects after reordering
  },
  async (input: QualifyAuctionsInput): Promise<AIAuction[]> => {
    if (!input.auctions || input.auctions.length === 0) {
      console.log('[qualifyAuctionsFlow] No auctions provided to qualify. Returning empty list.');
      return [];
    }

    try {
      const {output: rankedIds} = await qualifyAuctionsPrompt(input);

      if (!rankedIds || rankedIds.length === 0) {
          console.warn(
          `[qualifyAuctionsFlow] AI qualification (IDs) prompt returned no output. Query: "${input.query}". Auctions count: ${input.auctions.length}. Returning original auction list order.`
          );
          return input.auctions; 
      }
      
      if (rankedIds.length !== input.auctions.length) {
        console.warn(
          `[qualifyAuctionsFlow] AI qualification (IDs) prompt returned a list with an unexpected number of IDs. Input auctions count: ${input.auctions.length}, Output IDs count: ${rankedIds.length}. Query: "${input.query}". Returning original auction list order.`
        );
        return input.auctions; 
      }

      const originalIdsSet = new Set(input.auctions.map(a => a.id));
      const outputIdsSet = new Set(rankedIds);

      if (rankedIds.length !== outputIdsSet.size) {
        console.warn(
          `[qualifyAuctionsFlow] AI qualification (IDs) output contained duplicate IDs. Input auctions count: ${input.auctions.length}, Unique output IDs count: ${outputIdsSet.size}. Query: "${input.query}". Returning original auction list order.`
        );
        return input.auctions;
      }
      
      if (originalIdsSet.size !== outputIdsSet.size || !Array.from(originalIdsSet).every(id => outputIdsSet.has(id))) {
        console.warn(
          `[qualifyAuctionsFlow] AI qualification (IDs) output did not contain the exact same set of IDs as input. Input IDs count: ${originalIdsSet.size}, Output IDs count: ${outputIdsSet.size}. Query: "${input.query}". Returning original auction list order.`
        );
        return input.auctions; 
      }

      const auctionMap = new Map(input.auctions.map(auction => [auction.id, auction]));
      const reorderedAuctions: AIAuction[] = rankedIds.map(id => auctionMap.get(id)).filter(Boolean) as AIAuction[];
      
      if (reorderedAuctions.length !== input.auctions.length) {
          console.error('[qualifyAuctionsFlow] Mismatch in reorderedAuctions length after mapping. This indicates a logic flaw. Returning original list.');
          return input.auctions;
      }
      
      console.log(`[qualifyAuctionsFlow] Successfully reordered ${reorderedAuctions.length} auctions based on AI-qualified and ranked IDs for query: "${input.query}".`);
      return reorderedAuctions;

    } catch (e) {
      console.error(`[qualifyAuctionsFlow] Failed to qualify auctions for query "${input.query}", returning original list. Error:`, e);
      return input.auctions; 
    }
  }
);
