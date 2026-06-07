'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Stage {
  stage_number: number; stage_name: string;
  subtasks: { subtask_number: number; description: string; requires_photo: boolean }[]
}

interface UnitDetail {
  id: string; unit_code: string; unit_type: string; urgency: string;
  status: string; progress_pct: number; spk_stages: Stage[]
}

const STATUS_LABEL: Record<string, string> = {
  not_started: 'Belum Mulai', in_progress: 'Sedang Berjalan',
  pending_review: 'Menunggu Review', completed: 'Selesai',
}

export default function UnitDetailPage({ params }: { params: Promise<{ unit_id: string }> }) {
  const { unit_id } = use(params)
  const router = useRouter()
  const [unit, setUnit] = useState<UnitDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeStage, setActiveStage] = useState<number | null>(null)
  const [checked, setChecked] = useState<number[]>([])
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<Record<number, File[]>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    fetch(`/api/v1/lapangan/units/${unit_id}`)
      .then(r => r.json())
      .then(j => { setUnit(j.data); setLoading(false) })
  }, [unit_id])

  async function handleSubmit() {
    if (!activeStage || checked.length === 0) return
    setSubmitting(true)

    // In production: upload photos to R2 first, get URLs, then submit
    const res = await fetch(`/api/v1/units/${unit_id}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage_number: activeStage, subtasks_checked: checked, notes }),
    })

    if (res.ok) {
      setSubmitted(true)
      setTimeout(() => router.push('/lapangan'), 1500)
    }
    setSubmitting(false)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
      <p style={{ color: 'var(--t3)' }}>Memuat...</p>
    </div>
  )

  if (!unit) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
      <p style={{ color: 'var(--red)' }}>Unit tidak ditemukan</p>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col pb-24" style={{ background: 'var(--bg-base)', maxWidth: 480, margin: '0 auto' }}>
      <div className="h-[52px] flex items-center px-4 gap-3 sticky top-0 z-10"
        style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
        <Link href="/lapangan" className="text-xl" style={{ color: 'var(--t2)' }}>←</Link>
        <span className="font-bold text-[15px]" style={{ color: 'var(--t1)' }}>Unit {unit.unit_code}</span>
      </div>

      <main className="flex-1 p-4">
        {/* Progress */}
        <div className="rounded-2xl p-4 mb-4" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
          <div className="flex justify-between items-center mb-2">
            <span className="font-semibold" style={{ color: 'var(--t1)' }}>Progres Keseluruhan</span>
            <span className="text-lg font-bold" style={{ color: 'var(--accent-2)' }}>{Math.round(unit.progress_pct)}%</span>
          </div>
          <div className="h-2 rounded-full mb-2" style={{ background: 'var(--bg-3)' }}>
            <div className="h-2 rounded-full" style={{ width: `${unit.progress_pct}%`, background: 'var(--accent)' }} />
          </div>
          <span className="text-[12px]" style={{ color: STATUS_LABEL[unit.status] === 'Menunggu Review' ? 'var(--amber)' : 'var(--t3)' }}>
            {STATUS_LABEL[unit.status] ?? unit.status}
          </span>
        </div>

        {/* Tahapan */}
        <h2 className="text-[13px] font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
          Tahapan Pekerjaan
        </h2>

        <div className="space-y-2 mb-6">
          {(unit.spk_stages ?? []).map((stage, si) => {
            const isActive = activeStage === stage.stage_number
            const canSubmit = si === 0 || unit.status === 'in_progress'

            return (
              <div key={stage.stage_number} className="rounded-2xl overflow-hidden"
                style={{ background: 'var(--bg-1)', border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}` }}>

                <button onClick={() => setActiveStage(isActive ? null : stage.stage_number)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  disabled={!canSubmit}>
                  <span className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0"
                    style={{ background: isActive ? 'var(--accent)' : 'var(--bg-3)', color: isActive ? '#fff' : 'var(--t3)' }}>
                    {stage.stage_number}
                  </span>
                  <span className="flex-1 text-sm font-medium" style={{ color: canSubmit ? 'var(--t1)' : 'var(--t3)' }}>
                    {stage.stage_name}
                  </span>
                  <span style={{ color: 'var(--t3)' }}>{isActive ? '▲' : '▼'}</span>
                </button>

                {isActive && (
                  <div className="px-4 pb-4 space-y-2">
                    {stage.subtasks.map(st => (
                      <label key={st.subtask_number}
                        className="flex items-start gap-3 p-3 rounded-xl cursor-pointer"
                        style={{ background: 'var(--bg-2)' }}>
                        <input type="checkbox" className="mt-0.5 flex-shrink-0"
                          checked={checked.includes(st.subtask_number)}
                          onChange={e => setChecked(prev =>
                            e.target.checked ? [...prev, st.subtask_number] : prev.filter(n => n !== st.subtask_number)
                          )} />
                        <div className="flex-1">
                          <p className="text-[13px]" style={{ color: 'var(--t1)' }}>{st.description}</p>
                          {st.requires_photo && (
                            <label className="flex items-center gap-1.5 mt-2 cursor-pointer">
                              <span className="text-[11px]" style={{ color: 'var(--t3)' }}>📷 Foto wajib</span>
                              <input type="file" accept="image/*" capture="environment" className="hidden"
                                onChange={e => {
                                  if (e.target.files?.[0]) {
                                    setPhotos(prev => ({ ...prev, [st.subtask_number]: [...(prev[st.subtask_number] ?? []), e.target.files![0]] }))
                                  }
                                }} />
                              <span className="text-[11px] px-2 py-0.5 rounded"
                                style={{ background: 'var(--accent-sub)', color: 'var(--accent-2)' }}>
                                {photos[st.subtask_number]?.length ? `✓ ${photos[st.subtask_number].length} foto` : 'Ambil Foto'}
                              </span>
                            </label>
                          )}
                        </div>
                      </label>
                    ))}

                    <textarea value={notes} onChange={e => setNotes(e.target.value)}
                      placeholder="Catatan tambahan (opsional)..."
                      rows={2}
                      className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none mt-2"
                      style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </main>

      {/* Submit button — fixed bottom */}
      {activeStage && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] p-4"
          style={{ background: 'var(--bg-base)', borderTop: '1px solid var(--border)' }}>
          {submitted ? (
            <div className="w-full py-4 rounded-2xl text-center font-semibold"
              style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--green)', border: '1px solid rgba(16,185,129,0.3)' }}>
              ✓ Berhasil dikirim ke review!
            </div>
          ) : (
            <button onClick={handleSubmit} disabled={submitting || checked.length === 0}
              className="w-full py-4 rounded-2xl text-base font-semibold text-white disabled:opacity-40"
              style={{ background: 'var(--accent)', boxShadow: '0 0 24px var(--accent-glow)' }}>
              {submitting ? 'Mengirim...' : `Kirim ke Review (${checked.length} sub-tugas)`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
