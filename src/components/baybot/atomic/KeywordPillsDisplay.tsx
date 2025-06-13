
'use client';

import type React from 'react';
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

interface KeywordPillsDisplayProps {
  keywords: string[];
  onKeywordClick: (keyword: string) => void;
}

export const KeywordPillsDisplay: React.FC<KeywordPillsDisplayProps> = ({ keywords, onKeywordClick }) => {
  if (!keywords || keywords.length === 0) {
    return null;
  }

  return (
    <div>
      <h3 className="text-sm font-medium text-foreground mb-2 flex items-center">
        <Search className="w-4 h-4 mr-2 text-primary" />
        Related Searches
      </h3>
      <div className="flex flex-wrap gap-2">
        {keywords.map((keyword, index) => (
          <Button
            key={index}
            variant="outline"
            size="sm"
            className="h-auto py-1 px-3 text-xs rounded-full interactive-glow"
            onClick={() => onKeywordClick(keyword)}
          >
            {keyword}
          </Button>
        ))}
      </div>
    </div>
  );
};
