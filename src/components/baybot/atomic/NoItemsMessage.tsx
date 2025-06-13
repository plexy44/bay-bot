
'use client';

import type React from 'react';
import { Search } from 'lucide-react';

interface NoItemsMessageProps {
  title: string;
  description: string;
}

export const NoItemsMessage: React.FC<NoItemsMessageProps> = ({ title, description }) => {
  return (
    <div className="text-center py-10">
      <Search className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
      <h2 className="text-2xl font-headline mb-2">{title}</h2>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
};
