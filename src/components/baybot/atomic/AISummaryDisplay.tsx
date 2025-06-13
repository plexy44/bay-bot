
'use client';

import type React from 'react';
import { Sparkles } from "lucide-react";
import type { AnalysisResult } from '@/types';

interface AISummaryDisplayProps {
  analysis: AnalysisResult;
}

export const AISummaryDisplay: React.FC<AISummaryDisplayProps> = ({ analysis }) => {
  return (
    <div>
      <h3 className="text-sm font-medium text-foreground mb-1 flex items-center">
        <Sparkles className="w-4 h-4 mr-2 text-primary" />
        AI Summary
      </h3>
      <p className="text-sm bg-secondary/50 p-3 rounded-md text-secondary-foreground leading-relaxed backdrop-blur-sm border border-border/20">{analysis.summary}</p>
    </div>
  );
};
