import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from './cn.js';

/**
 * Button variants (local copy of `ui-kit`, ADR 0006 — same classes, same tokens).
 * All colors go through semantic tokens (`bg-accent`, `text-accent-fg`, …) —
 * no hard-coded colors. Focus is always visible (`focus-visible:ring-2`). The min/target
 * height respects ≥ 44px at size `md`.
 */
export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-md font-medium select-none',
    'transition-colors duration-fast ease-standard',
    'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
    'disabled:pointer-events-none disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
        secondary: 'bg-surface text-text border border-border hover:bg-bg',
        ghost: 'bg-transparent text-text hover:bg-accent-subtle',
        danger: 'bg-danger text-danger-fg hover:bg-danger-hover',
        link: 'bg-transparent text-accent underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-3 text-xs',
        md: 'h-11 px-4 text-sm', // 44px — a11y touch target
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Renders the component through the child (Radix Slot) instead of a `<button>`. */
  asChild?: boolean;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
  ref,
) {
  // `asChild` is incompatible with injecting a spinner (Slot requires a single child).
  const Comp = asChild ? Slot : 'button';
  const isDisabled = disabled ?? loading;

  if (asChild) {
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {children}
      </Comp>
    );
  }

  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </Comp>
  );
});
