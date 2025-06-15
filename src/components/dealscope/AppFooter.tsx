
'use client';

import type React from 'react';
import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Separator } from '@/components/ui/separator';

export const AppFooter: React.FC = () => {
  return (
    <footer className="sticky bottom-0 z-10 h-auto py-4 sm:h-16 flex items-center text-center border-t border-border/40 bg-background/60 backdrop-blur-lg text-sm text-muted-foreground">
      <div className="container mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 sm:gap-2">
        <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
          <p>&copy; {new Date().getFullYear()} DealScope. All rights reserved.</p>
          <div className="flex items-center gap-3">
            <Link href="/privacy-policy" className="hover:text-primary transition-colors">
              Privacy Policy
            </Link>
            <Separator orientation="vertical" className="h-4 bg-muted-foreground/50 hidden sm:block" />
            <Link href="/terms-and-conditions" className="hover:text-primary transition-colors">
              Terms & Conditions
            </Link>
          </div>
        </div>
        <ThemeToggle />
      </div>
    </footer>
  );
};
