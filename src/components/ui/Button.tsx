import clsx from 'clsx'
import type { HTMLMotionProps } from 'framer-motion'
import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary'

export type ButtonProps = {
  variant?: ButtonVariant
  leftIcon?: ReactNode
  rightIcon?: ReactNode
  children?: ReactNode
} & Omit<HTMLMotionProps<'button'>, 'type' | 'children'> & { type?: 'button' | 'submit' | 'reset' }

function Button({
  variant = 'primary',
  leftIcon,
  rightIcon,
  className,
  disabled,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <motion.button
      type={type}
      disabled={disabled}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ duration: 0.12 }}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold',
        'ring-1 ring-inset transition focus-visible:outline-none',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        variant === 'primary' && [
          'bg-[rgb(var(--color-primary))] text-white',
          'ring-white/10 hover:brightness-110 active:brightness-95',
        ],
        variant === 'secondary' && [
          'bg-slate-950/5 text-[color:rgb(var(--color-text))] ring-[color:rgb(var(--color-border))]',
          'hover:bg-slate-950/10 active:bg-slate-950/15 dark:bg-white/5 dark:hover:bg-white/10 dark:active:bg-white/15',
        ],
        className,
      )}
      {...rest}
    >
      {leftIcon ? <span className="flex items-center">{leftIcon}</span> : null}
      <span className="truncate">{children}</span>
      {rightIcon ? <span className="flex items-center">{rightIcon}</span> : null}
    </motion.button>
  )
}

export default Button
