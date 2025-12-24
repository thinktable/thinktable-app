import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

// Utility function to merge Tailwind CSS classes with clsx and tailwind-merge
// Handles conditional classes and resolves conflicts intelligently
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}



