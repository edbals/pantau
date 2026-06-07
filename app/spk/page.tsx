'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Template {
  id: string; name: string; level: string; total_stages: number;
  total_subtasks: number; applicable_unit_types: string[]; is_archived: boolean
}

export default function SpkPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/spk')
      .then(r => r.json())
      .then(j => { setTemplates(j.data ?? []); setLoading(false) })
  }, [])

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>
      <nav className="h-[52px] flex items-center px-5 gap-3"
        style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center font-extrabold text-white text-[13px]"
          style={{ background: 'var(--accent)', boxShadow: '0 0 12px var(--accent-glow)' }}>P</div>
        <Link href="/dashboard" className="text-[12px]" style={{ color: 'var(--t3)' }}>Dashboard</Link>
        <span style={{ color: 'var(--t3)' }}>/</span>
        <span className="text-[14px] font-medium" style={{ color: 'var(--t1)' }}>Template SPK</span>
      </nav>

      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold mb-0.5" style={{ color: 'var(--t1)' }}>Template SPK</h1>
            <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Surat Perintah Kerja — tahapan dan sub-tugas konstruksi</p>
          </div>
          <Link href="/spk/new"
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ background: 'var(--accent)', boxShadow: '0 0 12px var(--accent-glow)' }}>
            + Template Baru
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-12" style={{ color: 'var(--t3)' }}>Memuat...</div>
        ) : templates.length === 0 ? (
          <div className="rounded-xl p-12 text-center"
            style={{ background: 'var(--bg-1)', border: '1px dashed var(--border-md)' }}>
            <div className="text-4xl mb-3">📋</div>
            <p className="font-medium mb-1" style={{ color: 'var(--t2)' }}>Belum ada template SPK</p>
            <p className="text-sm mb-5" style={{ color: 'var(--t3)' }}>
              Buat template atau upload dokumen SPK untuk dianalisis AI
            </p>
            <Link href="/spk/new"
              className="inline-block px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: 'var(--accent)' }}>
              + Buat Template
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {templates.map(t => (
              <Link key={t.id} href={`/spk/${t.id}`}
                className="flex items-center justify-between p-4 rounded-xl"
                style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-[14px]" style={{ color: 'var(--t1)' }}>{t.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium uppercase"
                      style={{ background: 'var(--bg-3)', color: 'var(--t3)' }}>{t.level}</span>
                  </div>
                  <span className="text-[12px]" style={{ color: 'var(--t3)' }}>
                    {t.total_stages} tahap · {t.total_subtasks} sub-tugas
                  </span>
                </div>
                <span style={{ color: 'var(--t3)' }}>→</span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
