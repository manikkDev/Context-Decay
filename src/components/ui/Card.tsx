import clsx from 'clsx'
import type { HTMLAttributes, ReactNode } from 'react'

export type CardProps = {
  heading?: ReactNode
  description?: ReactNode
} & HTMLAttributes<HTMLDivElement>

function Card({ heading, description, className, children, ...rest }: CardProps) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-2xl p-5 surface-glass transition-shadow duration-200',
        'hover:shadow-[0_18px_48px_rgba(15,23,42,0.10)] dark:hover:shadow-[0_18px_48px_rgba(0,0,0,0.30)]',
        className,
      )}
      {...rest}
    >
      {heading || description ? (
        <div className="mb-4">
          {heading ? <div className="text-sm font-semibold">{heading}</div> : null}
          {description ? (
            <div className="mt-1 text-sm text-[color:rgb(var(--color-muted))]">{description}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}

export default Card
