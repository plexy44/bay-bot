
'use client';

import type React from 'react';
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, Sparkles, Zap } from "lucide-react";
import type { BayBotItem, AnalysisResult } from '@/types';
import { analyzeDeal, type AnalyzeDealInput } from '@/ai/flows/analyze-deal';

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
            description: item.description || "N/A", // Ensure description is passed
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
          {error && ( // Show error for both deals and auctions if applicable
            <div className="flex flex-col items-center justify-center h-40 text-destructive">
              <AlertTriangle className="h-12 w-12 mb-4" />
              <p>{error}</p>
            </div>
          )}
          {analysis && !isLoading && !error && item.type === 'deal' && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between items-center mb-1">
                  <h3 className="text-sm font-medium text-foreground">Risk Score</h3>
                  <span className="text-sm font-semibold text-primary">{animatedRiskScore}/100</span>
                </div>
                <Progress value={animatedRiskScore} aria-label="Risk score" className="h-3 [&>div]:bg-destructive/80 bg-destructive/20 backdrop-blur-sm" />
                <p className="text-xs text-muted-foreground">Higher score indicates higher risk (e.g., too good to be true, poor seller).</p>
              </div>
              <div className="space-y-2">
                 <div className="flex justify-between items-center mb-1">
                  <h3 className="text-sm font-medium text-foreground">Rarity Score</h3>
                   <span className="text-sm font-semibold text-primary">{animatedRarityScore}/100</span>
                </div>
                <Progress value={animatedRarityScore} aria-label="Rarity score" className="h-3 [&>div]:bg-primary/80 bg-primary/20 backdrop-blur-sm" />
                 <p className="text-xs text-muted-foreground">Higher score indicates a rarer find or exceptional value.</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-foreground mb-1 flex items-center">
                  <Sparkles className="w-4 h-4 mr-2 text-primary" />
                  AI Summary
                </h3>
                <p className="text-sm bg-secondary/50 p-3 rounded-md text-secondary-foreground leading-relaxed backdrop-blur-sm border border-border/20">{analysis.summary}</p>
              </div>
            </>
          )}
        </div>
         <div className="pt-4 border-t border-border/50">
            <Button onClick={onClose} variant="outline" className="w-full interactive-glow">Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
