import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class names: clsx for conditional classes + tailwind-merge to
 * resolve conflicting utilities (last one wins).
 * @param inputs - Class name arguments (strings, arrays, or conditionals).
 * @returns Resolved class string.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
