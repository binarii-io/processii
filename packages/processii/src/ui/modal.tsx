import { forwardRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from './cn.js';

/**
 * Modal / Dialog (Radix Dialog) — local copy vendored from `ui-kit` (ADR 0006, #95): same
 * classes and tokens, identical rendering. Traps focus, handles Escape + overlay click,
 * locks scroll. `Title` is required for accessibility (dialog role label).
 */
export const Modal = DialogPrimitive.Root;
export const ModalTrigger = DialogPrimitive.Trigger;
export const ModalClose = DialogPrimitive.Close;
export const ModalTitle = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function ModalTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-lg font-semibold text-text', className)}
      {...props}
    />
  );
});

export const ModalDescription = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function ModalDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-sm text-muted', className)}
      {...props}
    />
  );
});

export interface ModalContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  /** Shows the corner close button (default: true). */
  showClose?: boolean;
  /**
   * Accessible description of the dialog. When provided it is rendered (visually
   * hidden) and wired via `aria-describedby`. Otherwise render a `<ModalDescription>`
   * in `children` or leave the absence explicit (raises the Radix warning).
   */
  description?: string;
}

export const ModalContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ModalContentProps
>(function ModalContent(
  {
    className,
    children,
    showClose = true,
    description,
    'aria-describedby': ariaDescribedBy,
    ...props
  },
  ref,
) {
  // Radix warns when no description is rendered in `children`. When `description` is
  // passed we render a (hidden) `Dialog.Description` that Radix detects and wires
  // itself; otherwise we explicitly forward `aria-describedby` (provided value or
  // `undefined`, which raises the warning without breaking a11y).
  const ariaProps = description ? {} : { 'aria-describedby': ariaDescribedBy };
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-overlay bg-overlay animate-in fade-in-0" />
      <DialogPrimitive.Content
        ref={ref}
        {...ariaProps}
        className={cn(
          'fixed left-1/2 top-1/2 z-modal w-full max-w-md -translate-x-1/2 -translate-y-1/2',
          'rounded-xl border border-border bg-surface-raised p-6 shadow-lg outline-none',
          'flex flex-col gap-4 animate-in fade-in-0 zoom-in-95',
          className,
        )}
        {...props}
      >
        {description ? (
          <ModalDescription className="sr-only">{description}</ModalDescription>
        ) : null}
        {children}
        {showClose && (
          <DialogPrimitive.Close
            aria-label="Fermer"
            className={cn(
              // Touch target ≥ 44px (a11y AA, docs/08): size-11 clickable area,
              // visually compact icon (size-4) centered.
              'absolute right-2 top-2 inline-flex size-11 items-center justify-center rounded-md text-muted',
              'transition-colors hover:bg-accent-subtle hover:text-text',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <X aria-hidden className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
