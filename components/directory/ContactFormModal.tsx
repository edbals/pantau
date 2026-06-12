'use client'

import { useState, type CSSProperties } from 'react'
import { X, Plus, Check } from 'lucide-react'
import type { Contact } from '@/lib/types/database'
import { WhatsAppIcon, TelegramIcon } from '@/components/icons/BrandIcons'
import { CONTACT_ROLES, COUNTRY_CODES, buildContactUrl } from '@/components/map/contacts'

export interface ContactDraft {
  name: string
  role: string
  email: string | null
  has_whatsapp: boolean
  has_telegram: boolean
  country_code: string
  phone: string
}

interface Props {
  initial: Contact | null // null = add, otherwise edit
  busy: boolean
  onSubmit: (draft: ContactDraft) => void
  onClose: () => void
}

const field: CSSProperties = { background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }

// Reuse the preset roles, but if the contact's stored role isn't one of them we
// pre-select "Lainnya" and seed the custom field.
function splitRole(role: string): { sel: string; custom: string } {
  return (CONTACT_ROLES as readonly string[]).includes(role)
    ? { sel: role, custom: '' }
    : { sel: 'Lainnya', custom: role }
}

export default function ContactFormModal({ initial, busy, onSubmit, onClose }: Props) {
  const seedRole = splitRole(initial?.role ?? CONTACT_ROLES[0])
  const [name, setName] = useState(initial?.name ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [country, setCountry] = useState(initial?.country_code ?? '+62')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [roleSel, setRoleSel] = useState(seedRole.sel)
  const [customRole, setCustomRole] = useState(seedRole.custom)
  // New contacts default to WhatsApp on; both flags are independent toggles.
  const [hasWhatsapp, setHasWhatsapp] = useState(initial ? initial.has_whatsapp : true)
  const [hasTelegram, setHasTelegram] = useState(initial ? initial.has_telegram : false)

  const isOther = roleSel === 'Lainnya'
  const resolvedRole = isOther ? customRole.trim() : roleSel
  const digits = phone.replace(/\D/g, '')
  const canSubmit = !!name.trim() && !!digits && (!isOther || !!customRole.trim())
    && (hasWhatsapp || hasTelegram) && !busy
  const waPreview = hasWhatsapp && digits ? buildContactUrl('whatsapp', country, phone) : ''
  const tgPreview = hasTelegram && digits ? buildContactUrl('telegram', country, phone) : ''

  const platforms = [
    { key: 'wa', label: 'WhatsApp', Icon: WhatsAppIcon, color: '#25D366', on: hasWhatsapp, toggle: () => setHasWhatsapp(v => !v) },
    { key: 'tg', label: 'Telegram', Icon: TelegramIcon, color: '#2AABEE', on: hasTelegram, toggle: () => setHasTelegram(v => !v) },
  ]

  function submit() {
    if (!canSubmit) return
    onSubmit({
      name: name.trim(),
      role: resolvedRole,
      email: email.trim() || null,
      has_whatsapp: hasWhatsapp,
      has_telegram: hasTelegram,
      country_code: country,
      phone: digits,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(8,12,22,0.7)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}>
      <div className="w-[460px] max-w-[94vw] max-h-[88vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ background: 'var(--bg-1)', border: '1px solid var(--border-md)', boxShadow: '0 20px 60px rgba(0,0,0,0.55)' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>
            {initial ? 'Edit Kontak' : 'Tambah Kontak'}
          </h3>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded opacity-70 hover:opacity-100" style={{ color: 'var(--t2)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
          <div>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--t3)' }}>Nama</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Nama lengkap" autoFocus
              className="w-full px-3 py-2 rounded-lg text-[13px] outline-none" style={field} />
          </div>

          <div>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--t3)' }}>Peran</label>
            <select value={roleSel} onChange={e => setRoleSel(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-[13px] outline-none" style={field}>
              {CONTACT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              <option value="Lainnya">Lainnya…</option>
            </select>
            {isOther && (
              <input value={customRole} onChange={e => setCustomRole(e.target.value)} placeholder="Tulis peran khusus"
                className="w-full mt-2 px-3 py-2 rounded-lg text-[13px] outline-none" style={field} />
            )}
          </div>

          <div>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--t3)' }}>Email <span style={{ color: 'var(--t3)' }}>(opsional)</span></label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="nama@perusahaan.com"
              className="w-full px-3 py-2 rounded-lg text-[13px] outline-none" style={field} />
          </div>

          <div>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--t3)' }}>Saluran (boleh keduanya)</label>
            <div className="flex gap-2">
              {platforms.map(({ key, label, Icon, color, on, toggle }) => (
                <button key={key} onClick={toggle}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium transition-all"
                  style={{
                    background: on ? 'var(--bg-3)' : 'var(--bg-2)',
                    border: `1px solid ${on ? color : 'var(--border)'}`,
                    color: on ? 'var(--t1)' : 'var(--t3)',
                  }}>
                  {on ? <Check size={13} style={{ color }} /> : <Icon size={14} />} {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--t3)' }}>Nomor Telepon</label>
            <div className="flex gap-2">
              <select value={country} onChange={e => setCountry(e.target.value)}
                className="px-2 py-2 rounded-lg text-[13px] outline-none" style={field}>
                {COUNTRY_CODES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
              <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="numeric" placeholder="81234567890"
                onKeyDown={e => e.key === 'Enter' && submit()}
                className="flex-1 px-3 py-2 rounded-lg text-[13px] font-mono outline-none" style={field} />
            </div>
            {waPreview && <p className="text-[10px] mt-1 font-mono truncate" style={{ color: 'var(--accent-2)' }}>{waPreview}</p>}
            {tgPreview && <p className="text-[10px] mt-0.5 font-mono truncate" style={{ color: 'var(--accent-2)' }}>{tgPreview}</p>}
          </div>
        </div>

        <div className="flex gap-2 px-5 py-3.5 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg text-[13px] font-medium"
            style={{ background: 'var(--bg-2)', color: 'var(--t2)', border: '1px solid var(--border)' }}>
            Batal
          </button>
          <button onClick={submit} disabled={!canSubmit}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-semibold text-white"
            style={{ background: 'var(--accent)', opacity: canSubmit ? 1 : 0.5 }}>
            {initial ? <Check size={15} /> : <Plus size={15} />}
            {initial ? 'Simpan' : 'Tambah'}
          </button>
        </div>
      </div>
    </div>
  )
}
