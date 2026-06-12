'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Search, Crown, Users } from 'lucide-react'
import type { Contact } from '@/lib/types/database'
import { WhatsAppIcon, TelegramIcon } from '@/components/icons/BrandIcons'
import { whatsappUrlFor, telegramUrlFor, isLeadershipRole } from '@/components/map/contacts'
import AutosaveIndicator, { type AutosaveStatus } from '@/components/ui/AutosaveIndicator'

const SAVE_DEBOUNCE_MS = 800

interface Props {
  projectId: string
  initialContacts: Contact[]
  initialSelectedIds: string[]
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
}

// Notion-style single-page team picker: tick which roster contacts join this
// project. Selection autosaves (debounced) to project_team_members; "Lanjut ke
// Pemetaan" flushes the final save then routes to the map.
export default function ProjectTeamSetup({ projectId, initialContacts, initialSelectedIds }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelectedIds))
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const timer = useRef<number | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return initialContacts
    return initialContacts.filter(c => c.name.toLowerCase().includes(q) || c.role.toLowerCase().includes(q))
  }, [initialContacts, query])

  async function persist(ids: string[]) {
    setStatus('saving')
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/team`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_ids: ids }),
      })
      setStatus(res.ok ? 'saved' : 'idle')
    } catch {
      setStatus('idle')
    }
  }

  // Debounce so rapid ticking coalesces into one PUT.
  function scheduleSave(ids: string[]) {
    if (timer.current) window.clearTimeout(timer.current)
    setStatus('saving')
    timer.current = window.setTimeout(() => persist(ids), SAVE_DEBOUNCE_MS)
  }

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
    scheduleSave([...next])
  }

  async function continueToMap() {
    if (timer.current) window.clearTimeout(timer.current)
    await persist([...selected]) // flush the latest selection before leaving
    router.push(`/projects/${projectId}/map`)
  }

  return (
    <div>
      {/* Top-left autosave indicator + continue */}
      <div className="flex items-center justify-between mb-4">
        <AutosaveIndicator status={status} />
        <button onClick={continueToMap}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white"
          style={{ background: 'var(--accent)', boxShadow: '0 0 16px var(--accent-glow)' }}>
          Lanjut ke Pemetaan <ArrowRight size={15} />
        </button>
      </div>

      <div className="relative mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--t3)' }} />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari nama atau peran…"
          className="w-full pl-9 pr-3 py-2 rounded-lg text-[13px] outline-none"
          style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--t1)' }} />
      </div>

      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>
          Roster Perusahaan
        </span>
        <span className="text-[11px]" style={{ color: 'var(--t3)' }}>{selected.size} dipilih</span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl p-12 text-center" style={{ background: 'var(--bg-1)', border: '1px dashed var(--border-md)' }}>
          <Users size={30} className="mx-auto mb-3" style={{ color: 'var(--t3)' }} />
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--t2)' }}>
            {initialContacts.length === 0 ? 'Roster masih kosong' : 'Tidak ada hasil'}
          </p>
          <p className="text-[13px]" style={{ color: 'var(--t3)' }}>
            {initialContacts.length === 0
              ? 'Tambahkan kontak di Direktori Tim terlebih dahulu.'
              : 'Coba kata kunci lain.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
          {filtered.map((c, i) => {
            const isSelected = selected.has(c.id)
            const isLeader = isLeadershipRole(c.role)
            const waUrl = whatsappUrlFor(c)
            const tgUrl = telegramUrlFor(c)
            return (
              <div key={c.id}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors"
                onClick={() => toggle(c.id)}
                style={{
                  borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                  background: isSelected ? 'var(--accent-sub)' : 'transparent',
                }}>
                <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 text-[10px] font-bold"
                  style={{
                    background: isSelected ? 'var(--accent)' : 'transparent',
                    border: `1.5px solid ${isSelected ? 'var(--accent)' : 'var(--border-lg)'}`,
                    color: '#fff',
                  }}>
                  {isSelected ? '✓' : ''}
                </span>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0"
                  style={{ background: 'var(--accent-sub)', color: 'var(--accent-2)' }}>
                  {initials(c.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate flex items-center gap-1.5" style={{ color: 'var(--t1)' }}>
                    {c.name}
                    {isLeader && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--amber)' }}>
                        <Crown size={9} /> Pimpinan
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] truncate" style={{ color: 'var(--t3)' }}>{c.role}</div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                  {waUrl && (
                    <a href={waUrl} target="_blank" rel="noopener noreferrer" title="Chat WhatsApp" className="p-1 rounded-lg" style={{ background: 'var(--bg-2)' }}>
                      <WhatsAppIcon size={15} />
                    </a>
                  )}
                  {tgUrl && (
                    <a href={tgUrl} target="_blank" rel="noopener noreferrer" title="Chat Telegram" className="p-1 rounded-lg" style={{ background: 'var(--bg-2)' }}>
                      <TelegramIcon size={15} />
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
