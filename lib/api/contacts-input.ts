// Server-side validation/sanitization for contact roster writes.
// Never trust client input: strip HTML, keep digits only, clamp lengths,
// and only accept plain-object custom attributes.

export function cleanText(value: unknown, max: number): string {
  return String(value ?? '').replace(/<[^>]*>/g, '').trim().slice(0, max)
}

export function cleanCountryCode(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 4)
  return digits ? `+${digits}` : '+62'
}

export function cleanPhone(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, 20)
}

export function cleanBool(value: unknown): boolean {
  return value === true || value === 'true'
}

// Returns a normalized email, or null when empty/invalid (the column is nullable).
export function cleanEmail(value: unknown): string | null {
  const email = String(value ?? '').trim().slice(0, 254)
  if (!email) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

// Only accept a plain JSON object for the open custom-attributes bag.
export function cleanCustomAttributes(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}
