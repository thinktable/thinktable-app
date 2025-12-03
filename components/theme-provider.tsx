'use client'

// Theme provider component - manages theme state and applies dark mode
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type Theme = 'light' | 'dark' | 'system'

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  resolvedTheme: 'light' | 'dark' // The actual theme being used (resolves 'system')
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const [theme, setThemeState] = useState<Theme>('system')
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')

  // Initialize theme from localStorage on mount (client-side only)
  useEffect(() => {
    setMounted(true)
    
    // Only access localStorage and window after mount (client-side only)
    if (typeof window === 'undefined') return
    
    const saved = localStorage.getItem('thinkable-theme') as Theme | null
    const initialTheme = saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
    setThemeState(initialTheme)
    
    // Resolve initial theme
    if (initialTheme === 'system') {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      setResolvedTheme(systemDark ? 'dark' : 'light')
    } else {
      setResolvedTheme(initialTheme)
    }
  }, [])

  // Update resolved theme when theme changes
  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return

    if (theme === 'system') {
      // Listen to system preference changes
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const updateResolvedTheme = () => {
        setResolvedTheme(mediaQuery.matches ? 'dark' : 'light')
      }
      
      updateResolvedTheme()
      mediaQuery.addEventListener('change', updateResolvedTheme)
      
      return () => mediaQuery.removeEventListener('change', updateResolvedTheme)
    } else {
      setResolvedTheme(theme)
    }
  }, [theme, mounted])

  // Apply theme class to document root
  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return
    
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(resolvedTheme)
  }, [resolvedTheme, mounted])

  // Save theme to localStorage when it changes
  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return
    localStorage.setItem('thinkable-theme', theme)
  }, [theme, mounted])

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

