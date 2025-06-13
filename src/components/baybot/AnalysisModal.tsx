
'use client';

import type React from 'react';
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, Zap } from "lucide-react";
import type { BayBotItem, AnalysisResult } from '@/types';
import { analyzeDeal, type AnalyzeDealInput } from '@/ai/flows/analyze-deal';

// New Atomic Component Imports
import { DealPriceBreakdown } from './atomic/DealPriceBreakdown';
import { AIScoresDisplay } from './atomic/AIScoresDisplay';
import { AISummaryDisplay } from './atomic/AISummaryDisplay';

interface AnalysisModalProps {
  item: BayBotItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export const AnalysisModal: React.FC<AnalysisModalProps> = ({ item, isOpen, onClose }) => {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [animatedRiskScore, setAnimatedRiskScore] = useState(0);
  const [animatedRarityScore, setAnimatedRarityScore] = useState(0);

  useEffect(() => {
    if (isOpen && item && item.type === 'deal') {
      const performAnalysis = async () => {
        setIsLoading(true);
        setError(null);
        setAnalysis(null);
        setAnimatedRiskScore(0);
        setAnimatedRarityScore(0);

        try {
          const input: AnalyzeDealInput = {
            title: item.title,
            description: item.description || "N/A",
            price: item.price,
            originalPrice: item.originalPrice || item.price,
            discountPercentage: item.discountPercentage || 0,
            imageUrl: item.imageUrl,
          };
          const result = await analyzeDeal(input);
          setAnalysis(result);
        } catch (e) {
          console.error("Error analyzing item:", e);
          setError("Failed to analyze item. Please try again.");
        } finally {
          setIsLoading(false);
        }
      };
      performAnalysis();
    } else if (isOpen && item && item.type === 'auction') {
      setAnalysis(null);
      setError("AI analysis is currently available for deals only.");
      setIsLoading(false);
    }
  }, [isOpen, item]);

  useEffect(() => {
    if (analysis) {
      const riskTimer = setTimeout(() => setAnimatedRiskScore(analysis.riskScore), 100);
      const rarityTimer = setTimeout(() => setAnimatedRarityScore(analysis.rarityScore), 100);
      return () => {
        clearTimeout(riskTimer);
        clearTimeout(rarityTimer);
      };
    }
  }, [analysis]);

  if (!item) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[525px] glass-popover">
        <DialogHeader>
          <DialogTitle className="font-headline text-2xl flex items-center text-foreground">
            <Zap className="w-6 h-6 mr-2 text-primary" /> AI Analysis: {item.title}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {item.type === 'deal' ? "Powered by GenAI to assess risk and rarity." : "AI Analysis is for deals only."}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-6">
          {isLoading && item.type === 'deal' && (
            <div className="flex flex-col items-center justify-center h-40">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Analyzing deal, please wait...</p>
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center justify-center h-40 text-destructive">
              <AlertTriangle className="h-12 w-12 mb-4" />
              <p>{error}</p>
            </div>
          )}

          {item.type === 'deal' && !isLoading && !error && <DealPriceBreakdown item={item} /> }
          
          {analysis && !isLoading && !error && item.type === 'deal' && (
            <>
              <AIScoresDisplay
                analysis={analysis}
                animatedRiskScore={animatedRiskScore}
                animatedRarityScore={animatedRarityScore}
              />
              <AISummaryDisplay analysis={analysis} />
            </>
          )}
          
          {isLoading && item.type === 'deal' && (item.originalPrice || (item.discountPercentage && item.discountPercentage > 0)) && (
             <p className="text-center text-sm text-muted-foreground mt-2">Loading AI insights...</p>
           )}
        </div>
        <div className="pt-4 border-t border-border/50">
          <Button onClick={onClose} variant="outline" className="w-full interactive-glow">Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
