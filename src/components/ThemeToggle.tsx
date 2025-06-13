
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }
    return 'light'; // Default for SSR, will be corrected by inline script + client-side hydration
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // The theme state should be correctly initialized by the useState callback.
    // This effect is primarily for setting up the system theme listener.

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      // Only change theme if no user preference is stored in localStorage
      if (!localStorage.getItem('theme')) {
        const newSystemTheme = e.matches ? 'dark' : 'light';
        setTheme(newSystemTheme); // Update React state
        // Update DOM
        if (newSystemTheme === 'dark') {
          document.documentElement.classList.add('dark');
          document.documentElement.classList.remove('light');
        } else {
          document.documentElement.classList.remove('dark');
          document.documentElement.classList.add('light');
        }
      }
    };

    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
  }, []); // Empty dependency array: run once on mount.

  const toggleTheme = useCallback(() => {
    // Use functional update for setTheme to ensure we're working with the latest state
    setTheme(prevTheme => {
      const newTheme = prevTheme === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', newTheme);
      if (newTheme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      }
      return newTheme;
    });
  }, []);

  if (!mounted) {
    // Render a placeholder to avoid hydration mismatch for the icon during SSR
    return <div className="h-10 w-10 rounded-full border interactive-glow" aria-label="Loading theme toggle" />;
  }

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      className="rounded-full interactive-glow"
      aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      {theme === 'dark' ? <Sun className="h-[1.2rem] w-[1.2rem]" /> : <Moon className="h-[1.2rem] w-[1.2rem]" />}
    </Button>
  );
}
