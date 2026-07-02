import { forwardRef } from 'react';
import { cn } from './cn.js';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

/**
 * Multi-line text area (local copy of `ui-kit`, ADR 0006). Same state/error contract
 * as `Input`.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid = false, 'aria-invalid': ariaInvalid, disabled, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      disabled={disabled}
      aria-invalid={ariaInvalid ?? (invalid || undefined)}
      className={cn(
        'flex min-h-20 w-full rounded-md border bg-surface px-3 py-2 text-sm text-text',
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
