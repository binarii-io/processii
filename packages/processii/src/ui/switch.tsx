import { forwardRef } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from './cn.js';

export type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>;

/**
 * Accessible on/off switch (Radix: switch role + aria-checked). Local copy of
 * `ui-kit` (ADR 0006).
 */
export const Switch = forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  function Switch({ className, ...props }, ref) {
    return (
      <SwitchPrimitive.Root
        ref={ref}
        className={cn(
          'peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent',
          'transition-colors duration-fast ease-standard',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'data-[state=checked]:bg-accent data-[state=unchecked]:bg-input',
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            'pointer-events-none block size-5 rounded-full bg-surface shadow-sm',
            'transition-transform duration-fast ease-standard',
            'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
          )}
        />
      </SwitchPrimitive.Root>
    );
  },
);
