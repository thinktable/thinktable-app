import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

// Utility function to merge Tailwind CSS classes with clsx and tailwind-merge
// Handles conditional classes and resolves conflicts intelligently
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Generate a UUID v4 - compatible with all browsers including older Safari
// Falls back to manual generation if crypto.randomUUID() is not available
export function generateUUID(): string {
  // Try to use native crypto.randomUUID() if available (modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID()
    } catch (error) {
      // Fall through to manual generation if crypto.randomUUID() fails
    }
  }
  
  // Fallback: Manual UUID v4 generation for older browsers
  // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0 // Random number 0-15
    const v = c === 'x' ? r : (r & 0x3) | 0x8 // For 'y', ensure variant bits
    return v.toString(16) // Convert to hex
  })
}



