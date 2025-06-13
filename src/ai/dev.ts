
import { config } from 'dotenv';
config();

import '@/ai/flows/analyze-deal.ts';
import '@/ai/flows/rank-deals.ts';
import '@/ai/flows/qualify-auctions.ts'; // Added new flow
