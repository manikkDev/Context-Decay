import { MoonIcon, SparklesIcon, SunIcon, UserCircleIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import { type ReactNode, useMemo } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import useTheme from '../../hooks/useTheme'
import IconButton from '../ui/IconButton.tsx'

type MainLayoutProps = {
  children: ReactNode
  rightPanel?: ReactNode | null
  showRightPanel?: boolean
}

const navItems: Array<{ to: string; label: string }> = [
  { to: '/', label: 'Landing' },
  { to: '/demo', label: 'Demo' },
  { to: '/analyze', label: 'Analyzer' },
]

function MainLayout({ children, rightPanel, showRightPanel = false }: MainLayoutProps) {
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()

  const navLinks = useMemo(() => {
    return navItems.map((item) => {
      return (
        <motion.div
          key={item.to}
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
        >
          <NavLink
            to={item.to}
            className={({ isActive }) =>
              clsx(
                'block rounded-md px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'bg-slate-950/5 text-[color:rgb(var(--color-text))] dark:bg-white/5'
                  : 'text-[color:rgb(var(--color-muted))] hover:bg-slate-950/5 hover:text-[color:rgb(var(--color-text))] dark:hover:bg-white/5',
              )
            }
            aria-current={location.pathname === item.to ? 'page' : undefined}
          >
            {item.label}
          </NavLink>
        </motion.div>
      )
    })
  }, [location.pathname])

  return (
    <div className="relative min-h-screen overflow-x-clip">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[rgb(var(--color-primary))]/12 blur-3xl" />
        <div className="absolute -bottom-40 right-[-180px] h-[520px] w-[520px] rounded-full bg-[rgb(var(--color-secondary))]/12 blur-3xl" />
        <div className="absolute -bottom-40 left-[-180px] h-[520px] w-[520px] rounded-full bg-fuchsia-500/10 blur-3xl" />
      </div>
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="sticky top-0 z-40 border-b border-[color:rgb(var(--color-border))] bg-[color:rgb(var(--color-bg))]/80 backdrop-blur"
      >
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <Link to="/" className="flex min-w-0 items-center gap-3 rounded-xl focus-visible:outline-none">
              <div className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-[rgb(var(--color-primary))] to-[rgb(var(--color-secondary))] shadow-sm">
                <motion.svg
                  width="40"
                  height="40"
                  viewBox="0 0 40 40"
                  className="absolute inset-0"
                  aria-hidden="true"
                  initial={{ opacity: 0.45 }}
                  animate={{ opacity: 0.7 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                >
                  <motion.path
                    d="M5 26 C 11 15, 19 31, 26 18 S 35 12, 36 24"
                    fill="none"
                    stroke="rgba(255,255,255,0.9)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0.2, opacity: 0.6 }}
                    animate={{ pathLength: [0.2, 1, 0.35], opacity: [0.55, 0.9, 0.7] }}
                    transition={{ duration: 5.6, repeat: Infinity, ease: 'easeInOut' }}
                  />
                </motion.svg>
                <SparklesIcon className="relative h-5 w-5 text-white/95" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold leading-5">Context Decay</div>
                <div className="truncate text-xs text-[color:rgb(var(--color-muted))]">
                  Prototype design system
                </div>
              </div>
            </Link>

            <nav className="hidden items-center gap-1 sm:flex" aria-label="Primary">
              {navLinks}
            </nav>

            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 rounded-xl px-2 py-1.5 sm:flex surface-glass">
                <div className="grid h-7 w-7 place-items-center rounded-full bg-slate-950/10 dark:bg-white/10">
                  <UserCircleIcon className="h-5 w-5 text-[color:rgb(var(--color-muted))]" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="max-w-[140px] truncate text-xs font-medium">Hackathon mode</div>
                  <div className="max-w-[140px] truncate text-[11px] text-[color:rgb(var(--color-muted))]">
                    Motion + glass UI
                  </div>
                </div>
              </div>

              <IconButton
                ariaLabel={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                onClick={toggleTheme}
                variant="secondary"
                icon={theme === 'dark' ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
              />
            </div>
          </div>

          <div className="mt-3 sm:hidden">
            <div className="flex items-center gap-1" role="tablist" aria-label="Primary">
              {navLinks}
            </div>
          </div>
        </div>
      </motion.header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div
          className={clsx(
            'grid grid-cols-1 gap-6',
            showRightPanel ? 'lg:grid-cols-[minmax(0,1fr)_360px]' : 'lg:grid-cols-1',
          )}
        >
          <div className="min-w-0">{children}</div>
          {showRightPanel ? (
            <aside className="hidden lg:block">
              <div className="sticky top-[88px] space-y-4">
                {rightPanel ? (
                  rightPanel
                ) : (
                  <div className="rounded-2xl p-4 surface-glass">
                    <div className="text-sm font-semibold">Inspector</div>
                    <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">
                      Placeholder for analysis details and context signals.
                    </div>
                  </div>
                )}
              </div>
            </aside>
          ) : null}
        </div>
      </main>
    </div>
  )
}

export default MainLayout
