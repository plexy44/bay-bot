
'use client';

import type React from 'react';
import { Progress } from "@/components/ui/progress";
import type { AnalysisResult } from '@/types';
import { cn } from '@/lib/utils';

interface AIScoresDisplayProps {
  analysis: AnalysisResult;
  animatedRiskScore: number;
  animatedRarityScore: number;
}

export const AIScoresDisplay: React.FC<AIScoresDisplayProps> = ({ analysis, animatedRiskScore, animatedRarityScore }) => {
  
  const riskProgressTrackClass = animatedRiskScore >= 50 
    ? 'bg-red-200 dark:bg-red-800' // Adjusted dark mode track for better contrast
    : 'bg-green-200 dark:bg-green-800';
  const riskProgressIndicatorClass = animatedRiskScore >= 50 
    ? '[&>div]:bg-red-600' 
    : '[&>div]:bg-green-600';

  const rarityProgressTrackClass = animatedRarityScore >= 50 
    ? 'bg-green-200 dark:bg-green-800' 
    : 'bg-red-200 dark:bg-red-800';
  const rarityProgressIndicatorClass = animatedRarityScore >= 50 
    ? '[&>div]:bg-green-600' 
    : '[&>div]:bg-red-600';

  return (
    <>
      <div className="space-y-2">
        <div className="flex justify-between items-center mb-1">
          <h3 className="text-sm font-medium text-foreground">Risk Score</h3>
          <span className="text-sm font-semibold text-primary">{animatedRiskScore}/100</span>
        </div>
        <Progress 
          value={animatedRiskScore} 
          aria-label="Risk score" 
          className={cn(
            "h-3 backdrop-blur-sm", 
            riskProgressTrackClass, 
            riskProgressIndicatorClass
          )} 
        />
        <p className="text-xs text-muted-foreground">Higher score indicates higher risk (e.g., too good to be true, poor seller).</p>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between items-center mb-1">
          <h3 className="text-sm font-medium text-foreground">Rarity Score</h3>
          <span className="text-sm font-semibold text-primary">{animatedRarityScore}/100</span>
        </div>
        <Progress 
          value={animatedRarityScore} 
          aria-label="Rarity score" 
          className={cn(
            "h-3 backdrop-blur-sm", 
            rarityProgressTrackClass, 
            rarityProgressIndicatorClass
          )} 
        />
        <p className="text-xs text-muted-foreground">Higher score indicates a rarer find or exceptional value.</p>
      </div>
    </>
  );
};

