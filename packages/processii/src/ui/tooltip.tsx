import { forwardRef } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from './cn.js';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export type TooltipContentProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>;

/**
 * Tooltip content (Radix: tooltip role, appears on hover/keyboard focus). Local copy of
 * `ui-kit` (ADR 0006).
 */
export const TooltipContent = forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'z-tooltip max-w-xs rounded-md bg-surface-raised px-2.5 py-1.5',
          'text-xs text-text shadow-md border border-border',
          'animate-in fade-in-0',
          className,
        )}
        {...props}
      >
        {props.children}
        <TooltipPrimitive.Arrow className="fill-[var(--color-surface-raised)]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});
