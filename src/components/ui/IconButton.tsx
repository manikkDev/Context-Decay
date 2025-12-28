import clsx from 'clsx'
import type { HTMLMotionProps } from 'framer-motion'
import { motion } from 'framer-motion'
import type { ReactElement } from 'react'

export type IconButtonVariant = 'primary' | 'secondary'

export type IconButtonProps = {
  ariaLabel: string
  icon: ReactElement
  variant?: IconButtonVariant
} & Omit<HTMLMotionProps<'button'>, 'children' | 'aria-label' | 'type'> & {
    type?: 'button' | 'submit' | 'reset'
  }

function IconButton({
  ariaLabel,
  icon,
  variant = 'secondary',
  className,
  disabled,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <motion.button
      type={type}
      aria-label={ariaLabel}
      disabled={disabled}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ duration: 0.12 }}
      className={clsx(
        'inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-inset transition',
        'focus-visible:outline-none',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        variant === 'primary' && 'bg-[rgb(var(--color-primary))] text-white ring-white/10',
        variant === 'secondary' &&
          'bg-slate-950/5 text-[color:rgb(var(--color-text))] ring-[color:rgb(var(--color-border))] hover:bg-slate-950/10 dark:bg-white/5 dark:hover:bg-white/10',
        className,
      )}
      {...rest}
    >
      {icon}
    </motion.button>
  )
}

export default IconButton
