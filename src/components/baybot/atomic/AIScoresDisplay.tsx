
'use client';

import type React from 'react';
import { Progress } from "@/components/ui/progress";
import type { AnalysisResult } from '@/types';

interface AIScoresDisplayProps {
  analysis: AnalysisResult;
  animatedRiskScore: number;
  animatedRarityScore: number;
}

export const AIScoresDisplay: React.FC<AIScoresDisplayProps> = ({ analysis, animatedRiskScore, animatedRarityScore }) => {
  return (
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
    </>
  );
};
