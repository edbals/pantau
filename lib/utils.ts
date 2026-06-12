import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// shadcn/ui class-name combiner: merges conditional classes and de-duplicates
// conflicting Tailwind utilities (last one wins).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
