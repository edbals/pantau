'use client'

import { useState, type CSSProperties } from 'react'
import { X, Plus, Trash2, MessageCircle, Send } from 'lucide-react'
import {
  type ProjectContact, type Platform,
  CONTACT_ROLES, COUNTRY_CODES, buildContactUrl, contactPlatform,
} from './contacts'

interface Props {
  contacts: ProjectContact[]
  onAdd: (contact: Omit<ProjectContact, 'id'>) => void
  onDelete: (id: string) => void
  onClose: () => void
}

const field: CSSProperties = { background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }

// Wide, spacious "Manajemen Kontak Tim" modal: add contacts via structured
// phone fields (platform + country code + number), and manage the list.
export default function ContactDirectoryModal({ contacts, onAdd, onDelete, onClose }: Props) {
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<Platform>('whatsapp')
  const [country, setCountry] = useState('+62')
  const [phone, setPhone] = useState('')
  const [roleSel, setRoleSel] = useState<string>(CONTACT_ROLES[0])
  const [customRole, setCustomRole] = useState('')

  const isOther = roleSel === 'Lainnya'
  const resolvedRole = isOther ? customRole.trim() : roleSel
  const digits = phone.replace(/\D/g, '')
  const canAdd = !!name.trim() && !!digits && (!isOther || !!customRole.trim())
  const previewUrl = digits ? buildContactUrl(platform, country, phone) : ''

  function submit() {
    if (!canAdd) return
    onAdd({ name: name.trim(), role: resolvedRole, contactUrl: buildContactUrl(platform, country, phone) })
    setName(''); setPhone(''); setCustomRole('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(8,12,22,0.7)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}>
      <div className="w-[680px] max-w-[94vw] max-h-[86vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ background: 'var(--bg-1)', border: '1px solid var(--border-md)', boxShadow: '0 20px 60px rgba(0,0,0,0.55)' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>Manajemen Kontak Tim</h3>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded opacity-70 hover:opacity-100" style={{ color: 'var(--t2)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Add form */}
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>Tambah Kontak</p>

            <div>
              <label className="block text-[11px] mb-1" style={{ color: 'var(--t3)' }}>Nama</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Nama lengkap"
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
              <label className="block text-[11px] mb-1" style={{ color: 'var(--t3)' }}>Platform</label>
              <div className="flex gap-2">
                {([
                  { p: 'whatsapp' as Platform, label: 'WhatsApp', Icon: MessageCircle, color: '#25D366' },
                  { p: 'telegram' as Platform, label: 'Telegram', Icon: Send, color: '#229ED9' },
                ]).map(({ p, label, Icon, color }) => (
                  <button key={p} onClick={() => setPlatform(p)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium transition-all"
                    style={{
                      background: platform === p ? 'var(--bg-3)' : 'var(--bg-2)',
                      border: `1px solid ${platform === p ? color : 'var(--border)'}`,
                      color: platform === p ? 'var(--t1)' : 'var(--t3)',
                    }}>
                    <Icon size={14} style={{ color }} /> {label}
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
              {previewUrl && (
                <p className="text-[10px] mt-1 font-mono truncate" style={{ color: 'var(--accent-2)' }}>{previewUrl}</p>
              )}
            </div>

            <button onClick={submit} disabled={!canAdd}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-semibold text-white"
              style={{ background: 'var(--accent)', opacity: canAdd ? 1 : 0.5 }}>
              <Plus size={15} /> Tambah Kontak
            </button>
          </div>

          {/* List */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>
              Kontak ({contacts.length})
            </p>
            {contacts.length === 0 ? (
              <p className="text-[12px] py-4 text-center" style={{ color: 'var(--t3)' }}>Belum ada kontak.</p>
            ) : contacts.map(c => {
              const p = contactPlatform(c.contactUrl)
              return (
                <div key={c.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
                  style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] truncate" style={{ color: 'var(--t1)' }}>{c.name}</div>
                    <div className="text-[10px]" style={{ color: 'var(--t3)' }}>{c.role}</div>
                  </div>
                  {p && (
                    <a href={c.contactUrl} target="_blank" rel="noopener noreferrer"
                      title={p === 'whatsapp' ? 'Chat WhatsApp' : 'Chat Telegram'} className="flex-shrink-0">
                      {p === 'whatsapp'
                        ? <MessageCircle size={17} style={{ color: '#25D366' }} />
                        : <Send size={16} style={{ color: '#229ED9' }} />}
                    </a>
                  )}
                  <button onClick={() => onDelete(c.id)} title="Hapus" className="px-1.5 py-1 rounded flex-shrink-0"
                    style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--red)' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
