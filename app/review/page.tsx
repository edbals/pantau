'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Submission {
  id: string; unit_code: string; project_name: string; stage_number: number;
  stage_name: string; pengawas_name: string; urgency: string;
  submitted_at: string; subtasks_checked: number[]; notes: string | null
}

const URGENCY_ORDER: Record<string, number> = { critical: 0, high: 1, normal: 2 }

export default function ReviewPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Submission | null>(null)
  const [denyReason, setDenyReason] = useState('')
  const [denyOpen, setDenyOpen] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [done, setDone] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/v1/review/queue')
      .then(r => r.json())
      .then(j => {
        const sorted = (j.data ?? []).sort((a: Submission, b: Submission) =>
          (URGENCY_ORDER[a.urgency] ?? 2) - (URGENCY_ORDER[b.urgency] ?? 2)
        )
        setSubmissions(sorted)
        setLoading(false)
      })
  }, [])

  async function handleApprove(id: string) {
    setProcessing(true)
    await fetch(`/api/v1/submissions/${id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_decision: 'approved' }),
    })
    setDone(p => [...p, id])
    setSelected(null)
    setProcessing(false)
  }

  async function handleDeny(id: string) {
    if (!denyReason.trim()) return
    setProcessing(true)
    await fetch(`/api/v1/submissions/${id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_decision: 'denied', review_reason: denyReason }),
    })
    setDone(p => [...p, id])
    setDenyOpen(false)
    setSelected(null)
    setDenyReason('')
    setProcessing(false)
  }

  const pending = submissions.filter(s => !done.includes(s.id))

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>
      <nav className="h-[52px] flex items-center px-5 gap-3"
        style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center font-extrabold text-white text-[13px]"
          style={{ background: 'var(--accent)', boxShadow: '0 0 12px var(--accent-glow)' }}>P</div>
        <Link href="/dashboard" className="text-[12px]" style={{ color: 'var(--t3)' }}>Dashboard</Link>
        <span style={{ color: 'var(--t3)' }}>/</span>
        <span className="text-[14px] font-medium" style={{ color: 'var(--t1)' }}>Antrian Review</span>
        {pending.length > 0 && (
          <span className="text-[11px] px-1.5 py-0.5 rounded-full font-bold"
            style={{ background: 'var(--accent)', color: '#fff' }}>{pending.length}</span>
        )}
      </nav>

      <div className="flex flex-1 overflow-hidden">
        {/* Queue list */}
        <div className="w-[360px] flex-shrink-0 overflow-y-auto border-r" style={{ borderColor: 'var(--border)' }}>
          {loading ? (
            <div className="p-6 text-center" style={{ color: 'var(--t3)' }}>Memuat...</div>
          ) : pending.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-4xl mb-3">✅</div>
              <p className="font-medium mb-1" style={{ color: 'var(--t2)' }}>Semua sudah diulas</p>
              <p className="text-sm" style={{ color: 'var(--t3)' }}>Tidak ada submisi yang perlu diulas</p>
            </div>
          ) : (
            pending.map(s => (
              <button key={s.id} onClick={() => { setSelected(s); setDenyOpen(false) }}
                className="w-full text-left p-4 border-b transition-colors"
                style={{
                  borderColor: 'var(--border)',
                  background: selected?.id === s.id ? 'var(--bg-2)' : 'transparent',
                }}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-semibold text-sm" style={{ color: 'var(--t1)' }}>
                    {s.unit_code} — Tahap {s.stage_number}
                  </span>
                  {s.urgency !== 'normal' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold flex-shrink-0"
                      style={{
                        background: s.urgency === 'critical' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                        color: s.urgency === 'critical' ? 'var(--red)' : 'var(--amber)',
                      }}>
                      {s.urgency === 'critical' ? '🔴 Kritis' : '🟡 Tinggi'}
                    </span>
                  )}
                </div>
                <p className="text-[12px] mb-0.5" style={{ color: 'var(--t3)' }}>{s.stage_name}</p>
                <p className="text-[11px]" style={{ color: 'var(--t3)' }}>
                  {s.project_name} · {s.pengawas_name}
                </p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--t3)' }}>
                  {new Date(s.submitted_at).toLocaleString('id-ID')}
                </p>
              </button>
            ))
          )}
        </div>

        {/* Detail panel */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-4xl mb-3">👈</div>
                <p className="text-sm" style={{ color: 'var(--t3)' }}>Pilih submisi di sebelah kiri</p>
              </div>
            </div>
          ) : (
            <div className="max-w-xl">
              <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--t1)' }}>
                {selected.unit_code} — {selected.stage_name}
              </h2>
              <p className="text-sm mb-6" style={{ color: 'var(--t3)' }}>
                Dikirim oleh {selected.pengawas_name} · {new Date(selected.submitted_at).toLocaleString('id-ID')}
              </p>

              {/* Sub-tasks checked */}
              <div className="rounded-xl p-4 mb-4" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--t3)' }}>
                  Sub-tugas Selesai ({selected.subtasks_checked.length})
                </p>
                <div className="space-y-1.5">
                  {selected.subtasks_checked.map(n => (
                    <div key={n} className="flex items-center gap-2 text-sm">
                      <span style={{ color: 'var(--green)' }}>✓</span>
                      <span style={{ color: 'var(--t2)' }}>Sub-tugas {n}</span>
                    </div>
                  ))}
                </div>
              </div>

              {selected.notes && (
                <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--t3)' }}>Catatan</p>
                  <p className="text-sm" style={{ color: 'var(--t1)' }}>{selected.notes}</p>
                </div>
              )}

              {/* Action buttons */}
              {!denyOpen ? (
                <div className="flex gap-3">
                  <button onClick={() => handleApprove(selected.id)} disabled={processing}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
                    style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--green)', border: '1px solid rgba(16,185,129,0.3)' }}>
                    ✓ Setujui
                  </button>
                  <button onClick={() => setDenyOpen(true)}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold"
                    style={{ background: 'rgba(239,68,68,0.10)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.25)' }}>
                    ✕ Tolak
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <textarea value={denyReason} onChange={e => setDenyReason(e.target.value)}
                    placeholder="Alasan penolakan (wajib)..."
                    rows={3} autoFocus
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
                    style={{ background: 'var(--bg-2)', border: '1px solid rgba(239,68,68,0.4)', color: 'var(--t1)' }} />
                  <div className="flex gap-3">
                    <button onClick={() => setDenyOpen(false)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                      style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>
                      Batal
                    </button>
                    <button onClick={() => handleDeny(selected.id)} disabled={!denyReason.trim() || processing}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                      style={{ background: 'var(--red)', color: '#fff' }}>
                      {processing ? 'Menolak...' : 'Kirim Penolakan'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
