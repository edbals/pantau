'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import MapCanvas, { CanvasUnit } from '@/components/map/MapCanvas'

interface Project {
  id: string; name: string; project_code: string; project_type: string;
  status: string; canvas_data: { units: CanvasUnit[] } | null
}

interface UnitDetail {
  id: string; unit_code: string; unit_type: string; urgency: string;
  status: string; progress_pct: number; unit_submissions: Submission[]
}

interface Submission {
  id: string; stage_number: number; review_decision: string | null;
  submitted_at: string; notes: string | null; subtasks_checked: number[]
}

const STATUS_LABEL: Record<string, string> = {
  not_started: 'Belum Mulai', in_progress: 'Sedang Berjalan',
  pending_review: 'Menunggu Review', completed: 'Selesai',
}
const STATUS_COLOR: Record<string, string> = {
  not_started: 'var(--t3)', in_progress: 'var(--blue)',
  pending_review: 'var(--amber)', completed: 'var(--green)',
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [project, setProject] = useState<Project | null>(null)
  const [units, setUnits] = useState<CanvasUnit[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [unitDetail, setUnitDetail] = useState<UnitDetail | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/v1/projects/${id}`)
      .then(r => r.json())
      .then(j => {
        if (j.data) {
          setProject(j.data)
          setUnits(j.data.canvas_data?.units ?? [])
        }
        setLoading(false)
      })
  }, [id])

  useEffect(() => {
    if (!selectedId) return
    fetch(`/api/v1/units/${selectedId}`)
      .then(r => r.json())
      .then(j => setUnitDetail(j.data))
  }, [selectedId])

  function handleUnitSelect(uid: string | null) {
    setSelectedId(uid)
  }

  const stats = {
    total: units.length,
    completed: units.filter(u => u.status === 'completed').length,
    pending: units.filter(u => u.status === 'pending_review').length,
    inProgress: units.filter(u => u.status === 'in_progress').length,
    avgProgress: units.length > 0 ? Math.round(units.reduce((a, u) => a + (u.progress_pct ?? 0), 0) / units.length) : 0,
  }

  const filteredUnits = filter === 'all' ? units : units.filter(u => u.status === filter || u.urgency === filter)

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-base)' }}>

      {/* Nav */}
      <nav className="h-[52px] flex items-center px-5 gap-3 flex-shrink-0"
        style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center font-extrabold text-white text-[13px]"
          style={{ background: 'var(--accent)', boxShadow: '0 0 12px var(--accent-glow)' }}>P</div>
        <Link href="/dashboard" className="text-[12px]" style={{ color: 'var(--t3)' }}>Dashboard</Link>
        <span style={{ color: 'var(--t3)' }}>/</span>
        <span className="text-[14px] font-medium" style={{ color: 'var(--t1)' }}>{project?.name ?? '...'}</span>
        <div className="flex-1" />
        <Link href={`/projects/${id}/setup`}
          className="px-3 py-1.5 rounded-lg text-[12px] font-semibold"
          style={{ background: 'var(--accent-sub)', color: 'var(--accent-2)', border: '1px solid rgba(124,58,237,0.35)' }}>
          👥 Kelola Tim Proyek
        </Link>
        <Link href={`/projects/${id}/map`}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium"
          style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>
          ✏️ Edit Peta
        </Link>
        <Link href="/review"
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium"
          style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>
          📋 Review Queue
        </Link>
      </nav>

      {/* KPI strip */}
      <div className="flex gap-px flex-shrink-0" style={{ background: 'var(--border)', borderBottom: '1px solid var(--border)' }}>
        {[
          { label: 'Total Unit', value: stats.total, color: 'var(--t1)' },
          { label: 'Progres Rata-rata', value: `${stats.avgProgress}%`, color: 'var(--accent-2)' },
          { label: 'Selesai', value: stats.completed, color: 'var(--green)' },
          { label: 'Menunggu Review', value: stats.pending, color: 'var(--amber)' },
          { label: 'Berjalan', value: stats.inProgress, color: 'var(--blue)' },
        ].map(s => (
          <div key={s.label} className="flex-1 px-4 py-2.5" style={{ background: 'var(--bg-1)' }}>
            <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--t3)' }}>{s.label}</p>
            <p className="text-lg font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Map */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Filters */}
          <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0 overflow-x-auto"
            style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
            {[
              { key: 'all', label: 'Semua' },
              { key: 'not_started', label: 'Belum Mulai' },
              { key: 'in_progress', label: 'Berjalan' },
              { key: 'pending_review', label: 'Review' },
              { key: 'completed', label: 'Selesai' },
              { key: 'critical', label: '🔴 Kritis' },
              { key: 'high', label: '🟡 Tinggi' },
            ].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className="px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap flex-shrink-0"
                style={{
                  background: filter === f.key ? 'var(--accent)' : 'var(--bg-3)',
                  color: filter === f.key ? '#fff' : 'var(--t2)',
                }}>
                {f.label}
              </button>
            ))}
          </div>

          {/* Canvas */}
          <div className="flex-1 overflow-hidden">
            {loading ? (
              <div className="h-full flex items-center justify-center" style={{ color: 'var(--t3)' }}>Memuat peta...</div>
            ) : filteredUnits.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center p-8">
                <div>
                  <div className="text-4xl mb-3">🗺️</div>
                  <p className="font-medium mb-1" style={{ color: 'var(--t2)' }}>
                    {units.length === 0 ? 'Peta belum dibuat' : 'Tidak ada unit yang cocok'}
                  </p>
                  {units.length === 0 && (
                    <Link href={`/projects/${id}/map`}
                      className="inline-block mt-3 px-4 py-2 rounded-lg text-sm font-semibold text-white"
                      style={{ background: 'var(--accent)' }}>
                      Buka Map Studio →
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              <MapCanvas
                units={filteredUnits} onChange={() => {}}
                selectedId={selectedId} onSelect={handleUnitSelect}
                tool="select" readOnly showProgress
              />
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 flex-shrink-0"
            style={{ background: 'var(--bg-1)', borderTop: '1px solid var(--border)' }}>

            {/* Progress fill */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>Progres:</span>
              {[
                { color: 'rgba(156,163,175,0.4)', label: '1–24%' },
                { color: 'rgba(45,212,191,0.35)', label: '25–49%' },
                { color: 'rgba(20,184,166,0.5)', label: '50–74%' },
                { color: 'rgba(13,148,136,0.6)', label: '75–99%' },
                { color: 'rgba(16,185,129,0.7)', label: '100%' },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm" style={{ background: l.color, border: '1px solid rgba(255,255,255,0.08)' }} />
                  <span className="text-[10px]" style={{ color: 'var(--t3)' }}>{l.label}</span>
                </div>
              ))}
            </div>

            <div className="w-px h-3" style={{ background: 'var(--border-md)' }} />

            {/* Top line = urgency */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>Urgensi (atas):</span>
              <div className="flex items-center gap-1">
                <span className="w-5 h-[3px] rounded-full inline-block" style={{ background: '#F59E0B' }} />
                <span className="text-[10px]" style={{ color: 'var(--t3)' }}>Tinggi</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-5 h-[4px] rounded-full inline-block" style={{ background: '#EF4444' }} />
                <span className="text-[10px]" style={{ color: 'var(--t3)' }}>Kritis</span>
              </div>
            </div>

            <div className="w-px h-3" style={{ background: 'var(--border-md)' }} />

            {/* Bottom line = subcon */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>Subkon (bawah):</span>
              <span className="text-[10px]" style={{ color: 'var(--t3)' }}>warna sesuai subkontraktor</span>
            </div>
          </div>
        </div>

        {/* Unit detail panel */}
        {selectedId && (
          <div className="w-[300px] flex-shrink-0 overflow-y-auto border-l"
            style={{ background: 'var(--bg-1)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <span className="font-semibold" style={{ color: 'var(--t1)' }}>
                {units.find(u => u.id === selectedId)?.unit_code ?? 'Unit'}
              </span>
              <button onClick={() => setSelectedId(null)} style={{ color: 'var(--t3)' }} className="text-xl">×</button>
            </div>

            {!unitDetail ? (
              <div className="p-4 text-center" style={{ color: 'var(--t3)' }}>Memuat...</div>
            ) : (
              <div className="p-4 space-y-4">
                {/* Status + progress */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[13px] font-medium" style={{ color: STATUS_COLOR[unitDetail.status] }}>
                      {STATUS_LABEL[unitDetail.status]}
                    </span>
                    <span className="font-bold" style={{ color: 'var(--accent-2)' }}>
                      {Math.round(unitDetail.progress_pct)}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full" style={{ background: 'var(--bg-3)' }}>
                    <div className="h-2 rounded-full" style={{ width: `${unitDetail.progress_pct}%`, background: 'var(--accent)' }} />
                  </div>
                </div>

                {/* Urgency */}
                {unitDetail.urgency !== 'normal' && (
                  <div className="px-3 py-2 rounded-lg text-[12px] font-medium"
                    style={{
                      background: unitDetail.urgency === 'critical' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                      color: unitDetail.urgency === 'critical' ? 'var(--red)' : 'var(--amber)',
                      border: `1px solid ${unitDetail.urgency === 'critical' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
                    }}>
                    {unitDetail.urgency === 'critical' ? '🔴 Urgensi Kritis' : '🟡 Urgensi Tinggi'}
                  </div>
                )}

                {/* Submission history */}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--t3)' }}>
                    Riwayat Submisi
                  </p>
                  {(unitDetail.unit_submissions ?? []).length === 0 ? (
                    <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Belum ada submisi</p>
                  ) : (
                    <div className="space-y-2">
                      {unitDetail.unit_submissions.slice(0, 5).map(s => (
                        <div key={s.id} className="p-2.5 rounded-lg" style={{ background: 'var(--bg-2)' }}>
                          <div className="flex justify-between mb-0.5">
                            <span className="text-[12px] font-medium" style={{ color: 'var(--t1)' }}>
                              Tahap {s.stage_number}
                            </span>
                            <span className="text-[11px]"
                              style={{ color: s.review_decision === 'approved' ? 'var(--green)' : s.review_decision === 'denied' ? 'var(--red)' : 'var(--amber)' }}>
                              {s.review_decision === 'approved' ? '✓ Disetujui' : s.review_decision === 'denied' ? '✕ Ditolak' : '⏳ Review'}
                            </span>
                          </div>
                          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>
                            {new Date(s.submitted_at).toLocaleDateString('id-ID')}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
