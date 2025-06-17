
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
  auctions: z.array(AuctionSchema.omit({ rarityScore: true })).describe('The list of pre-filtered and server-sorted auctions to qualify and rank. Rarity score will be added by AI.'),
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

    const flowInput: QualifyAuctionsInput = { auctions: aiAuctionsInput, query };

    try {
        const qualifiedAiAuctionsWithRarityOutput: AIAuction[] = await qualifyAuctionsFlow(flowInput);

        const dealscopeAuctionMap = new Map(dealscopeAuctions.map(auction => [auction.id, auction]));

        const uniqueQualifiedAIAuctionsMap = new Map<string, AIAuction>();
        qualifiedAiAuctionsWithRarityOutput.forEach(aiAuction => {
            if (!uniqueQualifiedAIAuctionsMap.has(aiAuction.id)) {
                uniqueQualifiedAIAuctionsMap.set(aiAuction.id, aiAuction);
            }
        });
        const uniqueQualifiedAIAuctions = Array.from(uniqueQualifiedAIAuctionsMap.values());

        const reorderedDealScopeAuctions: DealScopeItem[] = uniqueQualifiedAIAuctions
            .map(aiAuction => {
                const originalDealScopeAuction = dealscopeAuctionMap.get(aiAuction.id);
                if (originalDealScopeAuction) {
                    return {
                        ...originalDealScopeAuction,
                        rarityScore: aiAuction.rarityScore, 
                    };
                }
                return null;
            })
            .filter(Boolean) as DealScopeItem[];

        if (reorderedDealScopeAuctions.length === 0 && dealscopeAuctions.length > 0 && qualifiedAiAuctionsWithRarityOutput.length === 0) {
             console.warn(`[qualifyAuctions entry] AI flow returned 0 qualified auctions for query "${query}" from ${dealscopeAuctions.length} inputs. The page will show NO AI-qualified auctions as AI explicitly returned empty. Input count: ${aiAuctionsInput.length}, AI output count: ${qualifiedAiAuctionsWithRarityOutput.length}`);
        }


        return reorderedDealScopeAuctions;

    } catch (e) {
        console.error(`[qualifyAuctions entry] Error calling qualifyAuctionsFlow for query "${query}". Returning original DealScope auction list as fallback (no AI rarity scores). Error:`, e);
        return dealscopeAuctions.map(auc => ({ ...auc, rarityScore: undefined }));
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
  prompt: `You are an expert shopping assistant specializing in eBay auctions. The following list of auctions has already been pre-filtered by the system.
User Query: "{{query}}"

{{#if query_is_specific query}}
CRITICAL INSTRUCTIONS FOR SPECIFIC USER QUERY: "{{query}}"
Your task is to RE-RANK the provided auctions based on their suitability for the user's query "{{query}}", ASSIGN a Rarity Score (0-100) to each auction, and return a list of these auctions.
For specific queries, you should aim to include MOST, if not ALL, of the provided auctions if they are at least a REASONABLE MATCH for "{{query}}". Your main job is to SORT them effectively and assign rarity.
*   **Relevance is Key for Ranking:** Items that are an EXACT or VERY STRONG match for "{{query}}" should be ranked highest.
*   **Accessory Filtering:** If "{{query}}" is for a main product (e.g., 'vintage Omega watch', 'Nikon D850 camera body'), you MUST RANK accessories (e.g., watch straps, camera bags unless the query *is* for an accessory) much lower or exclude them if they are clearly not what the user is looking for.
*   **Ranking Order AFTER Relevance:**
    1.  Strong Relevance to "{{query}}"
    2.  Time Sensitivity (Ending Soonest for relevant, good value items)
    3.  Potential Value & Bidding Dynamics (Price vs. market value, bid count)
    4.  Seller Credibility & Trust (High reputation >90-95% with good feedback count is preferred)
    5.  Item Condition (New/Refurbished generally better unless Used is exceptional value)
    6.  Rarity Score (As per definition provided below)
Filter out auctions *only if* they are:
    a) Clearly IRRELEVANT to a specific query "{{query}}".
    b) Accessories when the query "{{query}}" is for a main product.
    c) From sellers with critically low credibility (e.g., reputation far below 90% AND very few reviews).
Return an array of the auction objects (including your assigned 'rarityScore'), sorted from the best to worst. It's expected you'll return many items if the input list is relevant.
{{else}}
INSTRUCTIONS FOR GENERAL CURATION (Query: "{{query}}")
For general curation, focus on overall auction quality: credibility, potential value, items ending soon, and interesting/rare finds. Assign rarity scores. Rank accordingly. Be mindful of not including accessories if the general intent suggests a main product category. Aim to return a good selection of qualified auctions.
{{/if}}

Auctions to Re-rank and Score for Rarity (up to {{auctions.length}}):
{{#each auctions}}
- ID: {{id}}
  Title: "{{title}}"
  Current Bid: £{{price}}
  Seller Reputation: {{sellerReputation}}% ({{sellerFeedbackScore}} reviews)
  Condition: {{condition_or_default condition "Not specified"}}
  Time Left: {{timeLeft_or_default timeLeft "N/A"}}
  Bid Count: {{bidCount_or_default bidCount 0}}
{{/each}}

For each auction you include:
1.  Assess its **Rarity Score (0-100)**.
    *   **LOWER** scores (0-40) for common, easily available, mass-produced items.
    *   **MEDIUM** scores (41-70) for items that are less common, specific models, or good condition vintage.
    *   **HIGHER** scores (71-100) for genuinely hard-to-find items: vintage in excellent condition, limited editions, very specific/uncommon configurations, or exceptionally rare finds.

Return an array of the auction objects (including all original fields and your assigned 'rarityScore'), sorted from the best auction to the worst according to the criteria above.
The array can contain fewer items than the input if some auctions are not suitable based on the filtering rules, but for specific queries, aim to be inclusive.
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
Example response format if no auctions deemed suitable (should be rare for specific queries if input has items): []`,
  helpers: {
    condition_or_default: (value: string | undefined, defaultValue: string): string => value || defaultValue,
    timeLeft_or_default: (value: string | undefined, defaultValue: string): string => value || defaultValue,
    bidCount_or_default: (value: number | undefined, defaultValue: number): number => value ?? defaultValue,
    query_is_specific: (query: string) => {
      const qLower = query.toLowerCase();
      const systemQueryPatterns = [
        "general curated auction", 
        "background cache",
        "top-up/soft refresh" 
      ];
      const simpleGenericTerms = ["auctions", "bids", "live auctions"];

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

const qualifyAuctionsFlow = ai.defineFlow(
  {
    name: 'qualifyAuctionsFlowWithRarity',
    inputSchema: QualifyAuctionsInputSchema,
    outputSchema: QualifyAuctionsOutputSchema,
  },
  async (input: QualifyAuctionsInput): Promise<AIAuction[]> => {
    if (!input.auctions || input.auctions.length === 0) {
      return [];
    }

    try {
      const {output: qualifiedAuctionsWithRarity} = await qualifyAuctionsPrompt(input);

      if (!qualifiedAuctionsWithRarity) {
          console.warn(
          `[qualifyAuctionsFlow] AI prompt returned null/undefined. Query: "${input.query}". Input count: ${input.auctions.length}. Falling back to original list (no rarity).`
          );
          return input.auctions.map(auc => ({...auc, rarityScore: undefined, price: auc.price || 0 }));
      }

      if (qualifiedAuctionsWithRarity.length === 0 && input.auctions.length > 0) {
         console.info(`[qualifyAuctionsFlow] AI returned 0 auctions for query "${input.query}" from ${input.auctions.length} inputs. This is an explicit AI decision.`);
        return [];
      }
      if (qualifiedAuctionsWithRarity.length === 0 && input.auctions.length === 0) {
        return [];
      }

      const originalAuctionIds = new Set(input.auctions.map(auc => auc.id));
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
      return input.auctions.map(auc => ({...auc, rarityScore: undefined, price: auc.price || 0 }));
    }
  }
);
