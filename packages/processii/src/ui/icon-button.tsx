import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from './cn.js';

/**
 * Icon-only button (local copy of `ui-kit`, ADR 0006). `label` is
 * MANDATORY: it feeds `aria-label` to remain accessible (no visible text).
 * Targets ≥ 44px at size `md`.
 */
export const iconButtonVariants = cva(
  [
    'inline-flex items-center justify-center shrink-0',
    'rounded-md',
    'transition-colors duration-fast ease-standard',
    'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
    'disabled:pointer-events-none disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
        secondary: 'bg-surface text-text border border-border hover:bg-accent-subtle',
        ghost: 'bg-transparent text-muted hover:bg-accent-subtle hover:text-text',
        danger: 'bg-danger text-danger-fg hover:bg-danger-hover',
      },
      size: {
        sm: 'size-9',
        md: 'size-11', // 44px
        lg: 'size-12',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'md',
    },
  },
);

export interface IconButtonProps
  extends
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>,
    VariantProps<typeof iconButtonVariants> {
  /** Accessible label (required): becomes `aria-label`. */
  label: string;
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, label, loading = false, disabled, children, ...props },
  ref,
) {
  const isDisabled = disabled ?? loading;
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-busy={loading || undefined}
      disabled={isDisabled}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : children}
    </button>
  );
});
