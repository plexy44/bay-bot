
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
            return []; // If AI explicitly returns empty, respect that.
        }

        const dealscopeAuctionMap = new Map(dealscopeAuctions.map(auction => [auction.id, auction]));

        const uniqueQualifiedAIAuctionsMap = new Map<string, AIAuction>();
        qualifiedAiAuctionsWithRarityOutput.forEach(aiAuction => {
            if (dealscopeAuctionMap.has(aiAuction.id)) { // Ensure AI returned valid, original items
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
                        ...originalDealScopeAuction, // Start with original to preserve all its properties
                        ...aiAuction, // Overlay with AI's version (which includes rarityScore)
                        rarityScore: aiAuction.rarityScore, // Explicitly take AI's rarity score
                    };
                }
                return null;
            })
            .filter(Boolean) as DealScopeItem[];
        
        return reorderedDealScopeAuctions;

    } catch (e) {
        console.error(`[qualifyAuctions entry] Error calling qualifyAuctionsFlow for query "${query}". Returning original DealScope auction list as fallback (no AI rarity scores). Error:`, e);
        return dealscopeAuctions.map(auc => ({ ...auc, rarityScore: undefined })); // Fallback
    }
}


const qualifyAuctionsPrompt = ai.definePrompt({
  name: 'curateAndSortItemsPromptAuctions',
  input: {
    schema: QualifyAuctionsInputSchema,
  },
  output: {
    schema: QualifyAuctionsOutputSchema,
  },
  prompt: `You are an expert e-commerce curator with a deep understanding of the eBay marketplace. Your primary function is to intelligently sort and filter a provided list of items to create the most valuable and relevant view for the user. You must be precise but not overly strict, always aiming to provide a useful selection.

You will be given three pieces of information:

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

Based on the View Type, follow the corresponding logic below.

{{#eq viewType "Auctions"}}
Your goal is to find interesting and relevant auctions that the user can participate in.

Primary Sorting: Your primary sorting logic is soonest to end. Auctions ending in the near future are more urgent and valuable.

Secondary Sorting & Ranking: For items ending at similar times, apply this logic:

Keyword Relevance: Items that are a strong match for the user's query should be prioritized.

**Rarity Assessment**: For each auction you include, assign a \`rarityScore\` (0-100). Lower scores (0-40) for common items, medium (41-70) for less common or good condition vintage, higher (71-100) for genuinely hard-to-find items.

Minimum Viable List: Your goal is to present a healthy list of at least 16 auctions. If your initial quality filtering results in fewer than 16 items, you should be less strict and include more auctions that are a reasonable match for the user's query, even if they end further in the future.

Accessory Filtering (Important for Relevance): When the query is for a specific product (e.g., "vintage Omega watch"), you must filter out or significantly deprioritize irrelevant accessories like watch straps, empty boxes, or service manuals unless the query explicitly asks for such an accessory. The user generally wants the core product.
{{/eq}}

Mandatory Final Instruction:

After applying the logic, you must return the entire, re-ordered list of items in the exact original JSON format, matching the schema of the auction items (including the 'rarityScore' you assign). Do not add, remove, or alter any fields in the JSON objects beyond what the schema allows. Do not add any text, explanation, or summary. Your only output is the complete, sorted JSON array of qualified items. If no items are qualified, return an empty array.
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
Example response format if no auctions deemed suitable: []`,
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
          // Map input to AIAuction with undefined rarity if AI fails to return anything
          return input.items.map(auc => ({...auc, rarityScore: undefined, price: auc.price || 0 }));
      }

      if (qualifiedAuctionsWithRarity.length === 0 && input.items.length > 0) {
         console.info(`[qualifyAuctionsFlow] AI returned 0 auctions for query "${input.query}" from ${input.items.length} inputs. This is an explicit AI decision.`);
        return []; // Respect AI's decision to return no items
      }
      
      // Validate AI output
      const originalAuctionIds = new Set(input.items.map(auc => auc.id));
      const validatedAuctions = qualifiedAuctionsWithRarity.filter(auc => {
        if (!originalAuctionIds.has(auc.id)) {
          console.warn(`[qualifyAuctionsFlow] AI returned auction ID "${auc.id}" not in original input. Discarding.`);
          return false;
        }
        if (typeof auc.rarityScore !== 'number' || auc.rarityScore < 0 || auc.rarityScore > 100) {
            console.warn(`[qualifyAuctionsFlow] AI returned auction ID "${auc.id}" with invalid rarityScore: ${auc.rarityScore}. Setting to undefined.`);
            auc.rarityScore = undefined; // Correct invalid score
        }
        return true;
      });

      if (validatedAuctions.length !== qualifiedAuctionsWithRarity.length) {
          console.warn(`[qualifyAuctionsFlow] Some auctions from AI were discarded (invalid ID or rarity). Original AI count: ${qualifiedAuctionsWithRarity.length}, Validated: ${validatedAuctions.length}. Query: "${input.query}".`);
      }
      
      const uniqueValidatedAuctionsMap = new Map<string, AIAuction>();
      validatedAuctions.forEach(auc => {
        if (!uniqueValidatedAuctionsMap.has(auc.id)) { // Ensure uniqueness, AI might return duplicates
            uniqueValidatedAuctionsMap.set(auc.id, auc);
        }
      });

      return Array.from(uniqueValidatedAuctionsMap.values());

    } catch (e) {
      console.error(`[qualifyAuctionsFlow] CRITICAL FAILURE for query "${input.query}", returning original list (no rarity). Error:`, e);
      // Map input to AIAuction with undefined rarity in case of critical failure
      return input.items.map(auc => ({...auc, rarityScore: undefined, price: auc.price || 0 }));
    }
  }
);
    