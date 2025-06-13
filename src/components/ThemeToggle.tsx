
'use client';

import { useState, useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  // Initialize state from document class, which should be set by inline script
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }
    return 'dark'; // Fallback, though inline script should make this accurate
  });

  useEffect(() => {
    // Sync with localStorage and OS preference if no explicit choice is stored
    const storedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    let currentTheme: 'light' | 'dark';

    if (storedTheme) {
      currentTheme = storedTheme;
    } else {
      currentTheme = systemPrefersDark ? 'dark' : 'light';
    }
    
    if (theme !== currentTheme) { // If React state is out of sync with effective theme
        setTheme(currentTheme); // Sync React state
        // The class on documentElement should already be correct due to inline script or previous toggle
    }
    
    // Listener for system theme changes, to update if no theme is stored in localStorage
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) { // Only apply if no user preference is set
        const newSystemTheme = e.matches ? 'dark' : 'light';
        setTheme(newSystemTheme);
        if (newSystemTheme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);

  }, [theme]); // Re-run if theme state changes, to ensure consistency

  const toggleTheme = () => {
    setTheme(prevTheme => {
      const newTheme = prevTheme === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', newTheme);
      if (newTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return newTheme;
    });
  };

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      className="rounded-full interactive-glow"
      aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      {theme === 'light' ? <Moon className="h-[1.2rem] w-[1.2rem]" /> : <Sun className="h-[1.2rem] w-[1.2rem]" />}
    </Button>
  );
}
