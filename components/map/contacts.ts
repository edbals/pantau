// Shared helpers for the global team roster (the `contacts` table).
// The row type itself lives in lib/types/database.ts (Contact).

import type { ContactPlatform } from '@/lib/types/database'

export type Platform = ContactPlatform

export const CONTACT_ROLES = ['Subkontraktor', 'Pengawas', 'Field Manager'] as const

// Leadership roles oversee the whole project — in the map editor they're
// auto-assigned to every unit (checked + read-only). Matched by substring so
// custom roles like "Pantau CEO" or "Manajer Proyek" still resolve. Deliberately
// excludes "Field Manager" (operational, manually assigned per unit).
const LEADERSHIP_KEYWORDS = [
  'ceo', 'cto', 'coo', 'cfo', 'owner', 'pemilik', 'founder', 'pendiri',
  'director', 'direktur', 'project manager', 'manajer proyek', 'pimpinan',
  'principal', 'kepala proyek', 'leadership',
]

export function isLeadershipRole(role: string): boolean {
  const r = role.toLowerCase()
  return LEADERSHIP_KEYWORDS.some(k => r.includes(k))
}

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

// Builds a wa.me / t.me link from structured fields — digits only, so a raw
// user-supplied URL is never trusted or injected.
export function buildContactUrl(platform: Platform, countryCode: string, phone: string): string {
  const cc = countryCode.replace(/\D/g, '')
  const num = phone.replace(/\D/g, '').replace(/^0+/, '')
  const digits = `${cc}${num}`
  return platform === 'whatsapp' ? `https://wa.me/${digits}` : `https://t.me/+${digits}`
}

// A stored Contact can be reachable on WhatsApp and/or Telegram from the same
// number. These return the deep link when that flag is on, else null.
interface ContactLinkSource {
  has_whatsapp: boolean
  has_telegram: boolean
  country_code: string
  phone: string
}

export function whatsappUrlFor(c: Pick<ContactLinkSource, 'has_whatsapp' | 'country_code' | 'phone'>): string | null {
  return c.has_whatsapp ? buildContactUrl('whatsapp', c.country_code, c.phone) : null
}

export function telegramUrlFor(c: Pick<ContactLinkSource, 'has_telegram' | 'country_code' | 'phone'>): string | null {
  return c.has_telegram ? buildContactUrl('telegram', c.country_code, c.phone) : null
}
