'use client'

import { useMemo, useState } from 'react'
import { Plus, Search, Pencil, Trash2, Users } from 'lucide-react'
import type { Contact } from '@/lib/types/database'
import { WhatsAppIcon, TelegramIcon } from '@/components/icons/BrandIcons'
import { whatsappUrlFor, telegramUrlFor } from '@/components/map/contacts'
import AutosaveIndicator, { type AutosaveStatus } from '@/components/ui/AutosaveIndicator'
import ContactFormModal, { type ContactDraft } from './ContactFormModal'

interface Props {
  initialContacts: Contact[]
  canManage: boolean
}

type ModalState = { mode: 'add' } | { mode: 'edit'; contact: Contact } | null

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
}

export default function DirectoryRoster({ initialContacts, canManage }: Props) {
  const [contacts, setContacts] = useState<Contact[]>(initialContacts)
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<ModalState>(null)
  const [busy, setBusy] = useState(false)
  const [saveStatus, setSaveStatus] = useState<AutosaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter(c =>
      c.name.toLowerCase().includes(q) || c.role.toLowerCase().includes(q) || c.phone.includes(q))
  }, [contacts, query])

  async function handleSubmit(draft: ContactDraft) {
    setBusy(true)
    setSaveStatus('saving')
    setError(null)
    try {
      const editing = modal?.mode === 'edit' ? modal.contact : null
      const res = await fetch(editing ? `/api/v1/contacts/${editing.id}` : '/api/v1/contacts', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const json = await res.json()
      if (!res.ok || !json.data) throw new Error(json.error?.message ?? 'Gagal menyimpan kontak')
      const saved = json.data as Contact
      setContacts(prev => editing
        ? prev.map(c => (c.id === saved.id ? saved : c))
        : [saved, ...prev])
      setModal(null)
      setSaveStatus('saved')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan kontak')
      setSaveStatus('idle')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(contact: Contact) {
    if (!confirm(`Hapus ${contact.name} dari direktori?`)) return
    setSaveStatus('saving')
    setError(null)
    try {
      const res = await fetch(`/api/v1/contacts/${contact.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error?.message ?? 'Gagal menghapus kontak')
      }
      setContacts(prev => prev.filter(c => c.id !== contact.id))
      setSaveStatus('saved')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menghapus kontak')
      setSaveStatus('idle')
    }
  }

  return (
    <div>
      {/* Top-left autosave trust indicator */}
      <div className="mb-3">
        <AutosaveIndicator status={saveStatus} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--t3)' }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari nama, peran, atau nomor…"
            className="w-full pl-9 pr-3 py-2 rounded-lg text-[13px] outline-none"
            style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--t1)' }} />
        </div>
        {canManage && (
          <button onClick={() => setModal({ mode: 'add' })}
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white flex-shrink-0"
            style={{ background: 'var(--accent)', boxShadow: '0 0 16px var(--accent-glow)' }}>
            <Plus size={15} /> Tambah Kontak
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg text-[12px]"
          style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </div>
      )}

      {/* Roster grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl p-12 text-center" style={{ background: 'var(--bg-1)', border: '1px dashed var(--border-md)' }}>
          <Users size={32} className="mx-auto mb-3" style={{ color: 'var(--t3)' }} />
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--t2)' }}>
            {contacts.length === 0 ? 'Belum ada kontak' : 'Tidak ada hasil'}
          </p>
          <p className="text-[13px]" style={{ color: 'var(--t3)' }}>
            {contacts.length === 0
              ? (canManage ? 'Tambahkan anggota tim untuk membangun direktori perusahaan.' : 'Direktori tim masih kosong.')
              : 'Coba kata kunci lain.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(c => {
            const waUrl = whatsappUrlFor(c)
            const tgUrl = telegramUrlFor(c)
            return (
              <div key={c.id} className="rounded-xl p-4 flex items-center gap-3"
                style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-bold flex-shrink-0"
                  style={{ background: 'var(--accent-sub)', color: 'var(--accent-2)' }}>
                  {initials(c.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium truncate" style={{ color: 'var(--t1)' }}>{c.name}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--bg-3)', color: 'var(--t3)' }}>{c.role}</span>
                    <span className="text-[11px] font-mono truncate" style={{ color: 'var(--t3)' }}>{c.country_code} {c.phone}</span>
                  </div>
                  {c.email && <div className="text-[11px] truncate mt-0.5" style={{ color: 'var(--t3)' }}>{c.email}</div>}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {waUrl && (
                    <a href={waUrl} target="_blank" rel="noopener noreferrer" title="Chat WhatsApp"
                      className="p-1.5 rounded-lg" style={{ background: 'var(--bg-2)' }}>
                      <WhatsAppIcon size={16} />
                    </a>
                  )}
                  {tgUrl && (
                    <a href={tgUrl} target="_blank" rel="noopener noreferrer" title="Chat Telegram"
                      className="p-1.5 rounded-lg" style={{ background: 'var(--bg-2)' }}>
                      <TelegramIcon size={16} />
                    </a>
                  )}
                  {canManage && (
                    <>
                      <button onClick={() => setModal({ mode: 'edit', contact: c })} title="Edit"
                        className="p-1.5 rounded-lg" style={{ background: 'var(--bg-2)', color: 'var(--t2)' }}>
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDelete(c)} title="Hapus"
                        className="p-1.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--red)' }}>
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modal && (
        <ContactFormModal
          initial={modal.mode === 'edit' ? modal.contact : null}
          busy={busy}
          onSubmit={handleSubmit}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
