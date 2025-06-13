
'use client';

import type React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';

interface SearchFormProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const SearchForm: React.FC<SearchFormProps> = ({ searchQuery, setSearchQuery, onSubmit }) => {
  return (
    <form onSubmit={onSubmit} className="flex w-full md:w-80 items-center space-x-2">
      <Input
        type="search"
        placeholder="Search items on eBay.co.uk..."
        className="h-9 flex-1 bg-input/50 backdrop-blur-sm border-border/50 focus:bg-input/70"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <Button type="submit" size="sm" className="h-9 interactive-glow">
        <Search className="h-4 w-4" />
        <span className="sr-only">Search</span>
      </Button>
    </form>
  );
};
