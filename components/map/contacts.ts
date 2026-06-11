// Shared project-directory contact model + helpers.

export interface ProjectContact {
  id: string
  name: string
  role: string // preset or custom ("Lainnya") value
  contactUrl: string // generated wa.me/… or t.me/… link
}

export const CONTACT_ROLES = ['Subkontraktor', 'Pengawas', 'Field Manager'] as const

// Common SE-Asia-first country codes; default +62 (Indonesia).
export const COUNTRY_CODES: { code: string; label: string }[] = [
  { code: '+62', label: 'ID +62' },
  { code: '+60', label: 'MY +60' },
  { code: '+65', label: 'SG +65' },
  { code: '+63', label: 'PH +63' },
  { code: '+66', label: 'TH +66' },
  { code: '+84', label: 'VN +84' },
  { code: '+91', label: 'IN +91' },
  { code: '+1', label: 'US +1' },
  { code: '+44', label: 'UK +44' },
  { code: '+61', label: 'AU +61' },
]

export type Platform = 'whatsapp' | 'telegram'

// Detect the platform from a saved link (for rendering the right icon).
export function contactPlatform(url: string): Platform | null {
  if (!url) return null
  if (/wa\.me|whatsapp/i.test(url)) return 'whatsapp'
  if (/t\.me|telegram/i.test(url)) return 'telegram'
  return null
}

// Builds a wa.me / t.me link from structured fields — digits only, so a raw
// user-supplied URL is never trusted or injected.
export function buildContactUrl(platform: Platform, countryCode: string, phone: string): string {
  const cc = countryCode.replace(/\D/g, '')
  const num = phone.replace(/\D/g, '').replace(/^0+/, '')
  const digits = `${cc}${num}`
  return platform === 'whatsapp' ? `https://wa.me/${digits}` : `https://t.me/+${digits}`
}
