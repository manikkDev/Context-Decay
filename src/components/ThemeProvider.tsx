import { useCallback, useEffect, useMemo, useState } from 'react'
import { applyTheme, getSystemTheme, ThemeContext, type ThemeContextValue, type ThemeMode } from '../lib/theme'

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'light'
    const saved = window.localStorage.getItem('theme')
    if (saved === 'light' || saved === 'dark') return saved
    return getSystemTheme()
  })

  const setTheme = useCallback((nextTheme: ThemeMode) => {
    setThemeState(nextTheme)
    window.localStorage.setItem('theme', nextTheme)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [setTheme, theme])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const saved = window.localStorage.getItem('theme')
    if (saved === 'light' || saved === 'dark') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setThemeState(media.matches ? 'dark' : 'light')
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const value = useMemo<ThemeContextValue>(() => ({ theme, toggleTheme, setTheme }), [
    setTheme,
    theme,
    toggleTheme,
  ])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export default ThemeProvider
