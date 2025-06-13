
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      // Initialize based on class set by inline script in layout.tsx
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }
    return 'light'; // Default for SSR or if window is not defined yet (client will correct)
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Sync React state with the actual document theme on mount, just in case.
    // The inline script in layout.tsx should have set the correct class.
    const currentDocTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    if (theme !== currentDocTheme) {
      setTheme(currentDocTheme);
    }

    // Listener for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) { // Only apply if no user preference is set
        const newSystemTheme = e.matches ? 'dark' : 'light';
        setTheme(newSystemTheme); // Update React state
        // Update document class
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // `theme` is not needed as a dependency as its initial sync is handled.

  const toggleTheme = useCallback(() => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', newTheme); // Store user preference
    setTheme(newTheme); // Update React state

    // Directly update document class
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
  }, [theme]);

  if (!mounted) {
    // Render a placeholder to prevent hydration mismatch for the icon.
    // Sized to match the button to avoid layout shift.
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
