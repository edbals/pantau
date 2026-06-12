'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const PROJECT_TYPES = [
  { value: 'residential', label: 'Perumahan', icon: '🏘️' },
  { value: 'commercial', label: 'Komersial', icon: '🏢' },
  { value: 'industrial', label: 'Industri', icon: '🏭' },
  { value: 'mixed', label: 'Campuran', icon: '🏙️' },
]

export default function NewProjectPage() {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [type, setType] = useState('residential')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleNameChange(v: string) {
    setName(v)
    if (!code) {
      setCode(v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), project_code: code.trim(), project_type: type }),
    })
    const json = await res.json()

    if (!res.ok) {
      setError(json.error?.message ?? 'Gagal membuat proyek')
      setLoading(false)
      return
    }

    router.push(`/projects/${json.data.id}/setup`)
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>
      <nav className="h-[52px] flex items-center px-5 gap-3"
        style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center font-extrabold text-white text-[13px]"
          style={{ background: 'var(--accent)', boxShadow: '0 0 12px var(--accent-glow)' }}>P</div>
        <span className="font-bold text-[15px]" style={{ color: 'var(--t1)' }}>Pantau</span>
        <span style={{ color: 'var(--t3)' }}>/</span>
        <span className="text-[14px]" style={{ color: 'var(--t2)' }}>Proyek Baru</span>
      </nav>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--t1)' }}>Buat Proyek Baru</h1>
          <p className="text-sm mb-8" style={{ color: 'var(--t3)' }}>
            Setelah dibuat, Anda akan memilih tim proyek terlebih dahulu, lalu masuk ke Map Studio.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--t2)' }}>
                Nama Proyek
              </label>
              <input
                type="text" required value={name} onChange={e => handleNameChange(e.target.value)}
                placeholder="cth. Perumahan Grand Cikarang Barat"
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--border-md)')}
              />
            </div>

            {/* Code */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--t2)' }}>
                Kode Proyek <span style={{ color: 'var(--t3)' }}>(unik, huruf/angka)</span>
              </label>
              <input
                type="text" required value={code}
                onChange={e => setCode(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase())}
                placeholder="GCB-2024"
                maxLength={20}
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none font-mono"
                style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--border-md)')}
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: 'var(--t2)' }}>
                Tipe Proyek
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PROJECT_TYPES.map(pt => (
                  <button key={pt.value} type="button" onClick={() => setType(pt.value)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-left transition-all"
                    style={{
                      background: type === pt.value ? 'var(--accent-sub)' : 'var(--bg-2)',
                      border: type === pt.value ? '1px solid rgba(124,58,237,0.4)' : '1px solid var(--border-md)',
                      color: type === pt.value ? 'var(--accent-2)' : 'var(--t2)',
                    }}>
                    <span>{pt.icon}</span>
                    <span className="font-medium">{pt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="px-3 py-2.5 rounded-lg text-[13px]"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--red)' }}>
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Link href="/dashboard"
                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-center"
                style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>
                Batal
              </Link>
              <button type="submit" disabled={loading}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--accent)', boxShadow: '0 0 16px var(--accent-glow)' }}>
                {loading ? 'Membuat...' : 'Buat & Pilih Tim →'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
