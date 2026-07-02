import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges conditional classes (clsx) then deduplicates the conflicting Tailwind utilities
 * (tailwind-merge). Lets consumers override any class of a component via the `className`
 * prop. (Local copy of `ui-kit`, ADR 0006.)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
