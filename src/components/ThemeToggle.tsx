
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    // Initialize theme based on the class already set on <html> by the inline script
    // This is crucial for avoiding hydration mismatch for the initial render.
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }
    return 'light'; // Default for SSR, will be corrected by inline script + client-side hydration
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Defensively sync with DOM theme on mount if somehow out of sync with initial state.
    // This is a safeguard; the useState initializer should generally be correct.
    const currentDomTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    if (theme !== currentDomTheme) {
      setTheme(currentDomTheme);
    }

    // Listener for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      // Only change theme if no user preference is stored in localStorage
      // This respects an explicit user choice over system preference.
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
  }, []); // Empty dependency array: run once on mount to set up listener and mounted state.

  const toggleTheme = useCallback(() => {
    setTheme(prevTheme => {
      const newTheme = prevTheme === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem('theme', newTheme);
      } catch (e) {
        // Silently ignore localStorage write errors (e.g., private browsing, full storage)
      }
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
    // Render a placeholder to avoid hydration mismatch for the icon during SSR/initial client render
    // The dimensions match the Button to prevent layout shifts
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
