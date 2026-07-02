import { forwardRef } from 'react';
import { cn } from './cn.js';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Shows the error state (danger border + `aria-invalid`). */
  invalid?: boolean;
}

/**
 * Text field (local copy of `ui-kit`, ADR 0006). Error state via `invalid` (sets
 * `aria-invalid` for screen readers AND the danger border). Focus always visible.
 * 44px height (touch target).
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, 'aria-invalid': ariaInvalid, disabled, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      disabled={disabled}
      aria-invalid={ariaInvalid ?? (invalid || undefined)}
      className={cn(
        'flex h-11 w-full rounded-md border bg-surface px-3 text-sm text-text',
        'placeholder:text-muted',
        'transition-colors duration-fast ease-standard',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid ? 'border-danger focus-visible:ring-danger' : 'border-input',
        className,
      )}
      {...props}
    />
  );
});
