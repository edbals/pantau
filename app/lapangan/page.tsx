'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Assignment {
  unit_id: string; unit_code: string; unit_type: string;
  project_name: string; project_id: string; urgency: string;
  status: string; progress_pct: number;
}

const STATUS_LABEL: Record<string, string> = {
  not_started: 'Belum Mulai', in_progress: 'Sedang Berjalan',
  pending_review: 'Menunggu Review', completed: 'Selesai',
}
const STATUS_COLOR: Record<string, string> = {
  not_started: 'var(--t3)', in_progress: 'var(--blue)',
  pending_review: 'var(--amber)', completed: 'var(--green)',
}

export default function LapanganPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/lapangan/units')
      .then(r => r.json())
      .then(j => { setAssignments(j.data ?? []); setLoading(false) })
  }, [])

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)', maxWidth: 480, margin: '0 auto' }}>
      {/* Mobile status bar simulation */}
      <div className="h-[52px] flex items-center px-4 justify-between"
        style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center font-extrabold text-white text-[13px]"
            style={{ background: 'var(--accent)' }}>P</div>
          <span className="font-bold text-[15px]" style={{ color: 'var(--t1)' }}>Pantau</span>
        </div>
        <Link href="/dashboard" className="text-[11px] px-2 py-1 rounded"
          style={{ color: 'var(--t3)', background: 'var(--bg-3)' }}>Dashboard</Link>
      </div>

      <main className="flex-1 p-4">
        <h1 className="text-lg font-bold mb-1" style={{ color: 'var(--t1)' }}>Unit Saya</h1>
        <p className="text-[12px] mb-5" style={{ color: 'var(--t3)' }}>Unit yang ditugaskan kepada Anda</p>

        {loading ? (
          <div className="text-center py-12" style={{ color: 'var(--t3)' }}>Memuat...</div>
        ) : assignments.length === 0 ? (
          <div className="rounded-2xl p-8 text-center"
            style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
            <div className="text-4xl mb-3">📋</div>
            <p className="font-medium mb-1" style={{ color: 'var(--t2)' }}>Belum ada penugasan</p>
            <p className="text-sm" style={{ color: 'var(--t3)' }}>
              Koordinator akan menugaskan unit kepada Anda
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {assignments.map(a => (
              <Link key={a.unit_id} href={`/lapangan/unit/${a.unit_id}`}
                className="block rounded-2xl p-4"
                style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-lg" style={{ color: 'var(--t1)' }}>{a.unit_code}</span>
                  {a.urgency !== 'normal' && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                      style={{
                        background: a.urgency === 'critical' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                        color: a.urgency === 'critical' ? 'var(--red)' : 'var(--amber)',
                        border: `1px solid ${a.urgency === 'critical' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
                      }}>
                      {a.urgency === 'critical' ? '🔴 Kritis' : '🟡 Tinggi'}
                    </span>
                  )}
                </div>
                <p className="text-[12px] mb-3" style={{ color: 'var(--t3)' }}>{a.project_name}</p>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] font-medium" style={{ color: STATUS_COLOR[a.status] }}>
                    {STATUS_LABEL[a.status]}
                  </span>
                  <span className="text-[12px]" style={{ color: 'var(--t3)' }}>{Math.round(a.progress_pct)}%</span>
                </div>
                <div className="h-1.5 rounded-full" style={{ background: 'var(--bg-3)' }}>
                  <div className="h-1.5 rounded-full transition-all"
                    style={{ width: `${a.progress_pct}%`, background: 'var(--accent)' }} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
