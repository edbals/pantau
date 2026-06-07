'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Subtask { id: string; description: string; requires_photo: boolean }
interface Stage { id: string; name: string; subtasks: Subtask[] }

function sid() { return Math.random().toString(36).slice(2) }

export default function NewSpkPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [stages, setStages] = useState<Stage[]>([
    { id: sid(), name: '', subtasks: [{ id: sid(), description: '', requires_photo: false }] }
  ])
  const [saving, setSaving] = useState(false)
  const [synthesizing, setSynthesizing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addStage() {
    setStages(p => [...p, { id: sid(), name: '', subtasks: [{ id: sid(), description: '', requires_photo: false }] }])
  }

  function removeStage(stageId: string) {
    setStages(p => p.filter(s => s.id !== stageId))
  }

  function updateStage(stageId: string, name: string) {
    setStages(p => p.map(s => s.id === stageId ? { ...s, name } : s))
  }

  function addSubtask(stageId: string) {
    setStages(p => p.map(s =>
      s.id === stageId
        ? { ...s, subtasks: [...s.subtasks, { id: sid(), description: '', requires_photo: false }] }
        : s
    ))
  }

  function removeSubtask(stageId: string, subtaskId: string) {
    setStages(p => p.map(s =>
      s.id === stageId ? { ...s, subtasks: s.subtasks.filter(st => st.id !== subtaskId) } : s
    ))
  }

  function updateSubtask(stageId: string, subtaskId: string, patch: Partial<Subtask>) {
    setStages(p => p.map(s =>
      s.id === stageId
        ? { ...s, subtasks: s.subtasks.map(st => st.id === subtaskId ? { ...st, ...patch } : st) }
        : s
    ))
  }

  async function handleSynthesize(file: File) {
    setSynthesizing(true)
    const apiKey = '' // Gemini key not configured yet
    if (!apiKey) {
      // Demo: inject sample stages
      setStages([
        { id: sid(), name: 'Pekerjaan Persiapan', subtasks: [
          { id: sid(), description: 'Pembersihan lahan', requires_photo: true },
          { id: sid(), description: 'Pemasangan bowplank', requires_photo: false },
          { id: sid(), description: 'Mobilisasi peralatan', requires_photo: false },
        ]},
        { id: sid(), name: 'Pekerjaan Pondasi', subtasks: [
          { id: sid(), description: 'Galian tanah pondasi', requires_photo: true },
          { id: sid(), description: 'Urugan pasir', requires_photo: false },
          { id: sid(), description: 'Lantai kerja', requires_photo: true },
          { id: sid(), description: 'Pondasi batu kali', requires_photo: true },
        ]},
        { id: sid(), name: 'Pekerjaan Struktur', subtasks: [
          { id: sid(), description: 'Kolom beton bertulang', requires_photo: true },
          { id: sid(), description: 'Ring balok', requires_photo: true },
          { id: sid(), description: 'Curing beton', requires_photo: false },
        ]},
        { id: sid(), name: 'Pekerjaan Dinding', subtasks: [
          { id: sid(), description: 'Pasangan bata merah', requires_photo: true },
          { id: sid(), description: 'Plesteran dinding', requires_photo: false },
          { id: sid(), description: 'Acian dinding', requires_photo: false },
        ]},
        { id: sid(), name: 'Pekerjaan Atap', subtasks: [
          { id: sid(), description: 'Kuda-kuda baja ringan', requires_photo: true },
          { id: sid(), description: 'Reng dan gording', requires_photo: false },
          { id: sid(), description: 'Pemasangan genteng', requires_photo: true },
        ]},
      ])
      setSynthesizing(false)
      return
    }
    // Real Gemini call would go here
    setSynthesizing(false)
  }

  async function handleSave() {
    if (!name.trim()) { setError('Nama template wajib diisi'); return }
    if (stages.some(s => !s.name.trim())) { setError('Semua tahap harus memiliki nama'); return }

    setSaving(true)
    setError(null)

    const stagesPayload = stages.map((s, si) => ({
      stage_number: si + 1,
      stage_name: s.name,
      stage_code: `T${si + 1}`,
      required_photo_count: s.subtasks.filter(st => st.requires_photo).length,
      subtasks: s.subtasks.map((st, sti) => ({
        subtask_number: sti + 1,
        description: st.description,
        requires_photo: st.requires_photo,
      })),
    }))

    const totalSubtasks = stages.reduce((acc, s) => acc + s.subtasks.length, 0)

    const res = await fetch('/api/v1/spk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        level: 'org',
        applicable_unit_types: ['house'],
        stages: stagesPayload,
        total_stages: stages.length,
        total_subtasks: totalSubtasks,
      }),
    })

    const json = await res.json()
    if (!res.ok) { setError(json.error?.message ?? 'Gagal menyimpan'); setSaving(false); return }
    router.push('/spk')
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>
      <nav className="h-[52px] flex items-center px-5 gap-3 sticky top-0 z-10"
        style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center font-extrabold text-white text-[13px]"
          style={{ background: 'var(--accent)', boxShadow: '0 0 12px var(--accent-glow)' }}>P</div>
        <Link href="/spk" className="text-[12px]" style={{ color: 'var(--t3)' }}>Template SPK</Link>
        <span style={{ color: 'var(--t3)' }}>/</span>
        <span className="text-[14px] font-medium" style={{ color: 'var(--t1)' }}>Baru</span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer"
          style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>
          {synthesizing ? '⏳ Menganalisis...' : '🤖 Analisis Dokumen SPK'}
          <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.pdf"
            onChange={e => e.target.files?.[0] && handleSynthesize(e.target.files[0])} />
        </label>
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--accent)', boxShadow: '0 0 12px var(--accent-glow)' }}>
          {saving ? 'Menyimpan...' : 'Simpan Template'}
        </button>
      </nav>

      <main className="flex-1 p-6 max-w-2xl mx-auto w-full">
        {/* Template name */}
        <div className="mb-6">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--t2)' }}>Nama Template</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="cth. Rumah 2 Lantai Type 36"
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{ background: 'var(--bg-1)', border: '1px solid var(--border-md)', color: 'var(--t1)' }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--border-md)')} />
        </div>

        {error && (
          <div className="mb-4 px-3 py-2.5 rounded-lg text-[13px]"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--red)' }}>
            {error}
          </div>
        )}

        {/* Stages */}
        <div className="space-y-4">
          {stages.map((stage, si) => (
            <div key={stage.id} className="rounded-xl overflow-hidden"
              style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>

              {/* Stage header */}
              <div className="flex items-center gap-3 px-4 py-3"
                style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 text-white"
                  style={{ background: 'var(--accent)' }}>{si + 1}</span>
                <input value={stage.name} onChange={e => updateStage(stage.id, e.target.value)}
                  placeholder={`Nama Tahap ${si + 1}`}
                  className="flex-1 bg-transparent text-sm font-medium outline-none"
                  style={{ color: 'var(--t1)' }} />
                {stages.length > 1 && (
                  <button onClick={() => removeStage(stage.id)} className="text-[18px] leading-none"
                    style={{ color: 'var(--t3)' }}>×</button>
                )}
              </div>

              {/* Subtasks */}
              <div className="p-3 space-y-2">
                {stage.subtasks.map(st => (
                  <div key={st.id} className="flex items-center gap-2">
                    <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: 'var(--border-md)' }} />
                    <input value={st.description}
                      onChange={e => updateSubtask(stage.id, st.id, { description: e.target.value })}
                      placeholder="Deskripsi sub-tugas..."
                      className="flex-1 px-2.5 py-1.5 rounded text-[12px] outline-none"
                      style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--t1)' }} />
                    <label className="flex items-center gap-1 text-[11px] cursor-pointer flex-shrink-0"
                      style={{ color: st.requires_photo ? 'var(--accent-2)' : 'var(--t3)' }}>
                      <input type="checkbox" checked={st.requires_photo}
                        onChange={e => updateSubtask(stage.id, st.id, { requires_photo: e.target.checked })}
                        className="rounded" />
                      📷
                    </label>
                    {stage.subtasks.length > 1 && (
                      <button onClick={() => removeSubtask(stage.id, st.id)}
                        className="text-[16px] leading-none" style={{ color: 'var(--t3)' }}>×</button>
                    )}
                  </div>
                ))}
                <button onClick={() => addSubtask(stage.id)}
                  className="text-[11px] px-3 py-1 rounded ml-3"
                  style={{ color: 'var(--accent-2)', background: 'var(--accent-sub)' }}>
                  + Sub-tugas
                </button>
              </div>
            </div>
          ))}
        </div>

        <button onClick={addStage}
          className="w-full mt-4 py-3 rounded-xl text-sm font-medium"
          style={{ background: 'var(--bg-1)', border: '1px dashed var(--border-md)', color: 'var(--t2)' }}>
          + Tambah Tahap
        </button>
      </main>
    </div>
  )
}
