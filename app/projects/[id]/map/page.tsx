'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import MapCanvas, { CanvasUnit, UnitType } from '@/components/map/MapCanvas'

type Tool = 'select' | 'draw' | 'delete'
type ConfigTab = 'type' | 'urgency' | 'subcontractor' | 'spk' | 'supervisor'

const UNIT_TYPES: { value: UnitType; label: string; icon: string }[] = [
  { value: 'house', label: 'Rumah', icon: '🏠' },
  { value: 'apartment', label: 'Apartemen', icon: '🏢' },
  { value: 'shophouse', label: 'Ruko', icon: '🏪' },
  { value: 'commercial', label: 'Komersial', icon: '🏬' },
  { value: 'villa', label: 'Vila', icon: '🏡' },
  { value: 'road', label: 'Jalan', icon: '🛣️' },
  { value: 'common_area', label: 'Area Bersama', icon: '🌳' },
  { value: 'parking', label: 'Parkir', icon: '🅿️' },
  { value: 'facility', label: 'Fasilitas', icon: '🏋️' },
  { value: 'drainage', label: 'Drainase', icon: '💧' },
  { value: 'boundary', label: 'Batas', icon: '📏' },
]

const URGENCY_OPTIONS = [
  { value: 'normal', label: 'Normal', color: 'var(--t3)' },
  { value: 'high', label: 'Tinggi', color: 'var(--amber)' },
  { value: 'critical', label: 'Kritis', color: 'var(--red)' },
]

const SUB_COLORS = ['#7C3AED','#3B82F6','#10B981','#F59E0B','#EF4444','#EC4899','#14B8A6','#F97316']

export default function MapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [project, setProject] = useState<{ name: string; project_code: string } | null>(null)
  const [units, setUnits] = useState<CanvasUnit[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [configTab, setConfigTab] = useState<ConfigTab>('type')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [digitizing, setDigitizing] = useState(false)
  const [subName, setSubName] = useState('')
  const [subs, setSubs] = useState<{ name: string; color: string }[]>([])
  const [unitCode, setUnitCode] = useState('')
  const [unitLabel, setUnitLabel] = useState('')

  const selected = units.find(u => u.id === selectedId) ?? null

  // Load project
  useEffect(() => {
    fetch(`/api/v1/projects/${id}`)
      .then(r => r.json())
      .then(j => {
        if (j.data) {
          setProject({ name: j.data.name, project_code: j.data.project_code })
          if (j.data.canvas_data?.units) setUnits(j.data.canvas_data.units)
        }
      })
  }, [id])

  // Sync selected unit fields
  useEffect(() => {
    if (selected) {
      setUnitCode(selected.unit_code)
      setUnitLabel(selected.label ?? '')
    }
  }, [selectedId])

  function updateSelected(patch: Partial<CanvasUnit>) {
    if (!selectedId) return
    setUnits(prev => prev.map(u => u.id === selectedId ? { ...u, ...patch } : u))
  }

  const save = useCallback(async () => {
    setSaving(true)
    await fetch(`/api/v1/projects/${id}/map/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canvas_data: { units } }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [id, units])

  // Ctrl+S to save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save() }
      if (e.key === 'v') setTool('select')
      if (e.key === 'r') setTool('draw')
      if (e.key === 'd') setTool('delete')
      if (e.key === 'Escape') setSelectedId(null)
      if (e.key === 'Delete' && selectedId) {
        setUnits(prev => prev.filter(u => u.id !== selectedId))
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, selectedId])

  async function handleDigitize(file: File) {
    setDigitizing(true)
    const fd = new FormData()
    fd.append('image', file)
    const res = await fetch(`/api/v1/projects/${id}/map/digitize`, { method: 'POST', body: fd })
    const json = await res.json()
    if (json.data?.detected_units) {
      const mapped: CanvasUnit[] = json.data.detected_units.map((d: {
        temp_id: string; suggested_code: string; type: UnitType;
        coordinates: { x: number; y: number; width: number; height: number }
        label_detected: string | null
      }) => ({
        id: d.temp_id,
        unit_code: d.suggested_code ?? d.temp_id,
        unit_type: d.type,
        x: d.coordinates.x, y: d.coordinates.y,
        width: d.coordinates.width, height: d.coordinates.height,
        label: d.label_detected ?? undefined,
      }))
      setUnits(mapped)
    }
    setDigitizing(false)
  }

  function addSub() {
    if (!subName.trim()) return
    const color = SUB_COLORS[subs.length % SUB_COLORS.length]
    setSubs(prev => [...prev, { name: subName.trim(), color }])
    setSubName('')
  }

  function goLive() {
    save().then(() => {
      fetch(`/api/v1/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active', go_live_at: new Date().toISOString() }),
      }).then(() => router.push(`/projects/${id}`))
    })
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-base)' }}>

      {/* Top bar */}
      <div className="h-[52px] flex items-center px-4 gap-3 flex-shrink-0"
        style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>

        <div className="w-7 h-7 rounded-lg flex items-center justify-center font-extrabold text-white text-[13px]"
          style={{ background: 'var(--accent)', boxShadow: '0 0 12px var(--accent-glow)' }}>P</div>

        <Link href="/dashboard" className="text-[12px]" style={{ color: 'var(--t3)' }}>Dashboard</Link>
        <span style={{ color: 'var(--t3)' }}>/</span>
        <span className="text-[13px] font-medium" style={{ color: 'var(--t1)' }}>
          {project?.name ?? '...'}
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded font-mono"
          style={{ background: 'var(--bg-3)', color: 'var(--t3)' }}>
          {project?.project_code}
        </span>

        <div className="flex-1" />

        {/* Upload site plan */}
        <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer"
          style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>
          {digitizing ? '⏳ Menganalisis...' : '📂 Upload Denah'}
          <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.heic,.pdf"
            onChange={e => e.target.files?.[0] && handleDigitize(e.target.files[0])} />
        </label>

        <button onClick={save} disabled={saving}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium"
          style={{ background: 'var(--bg-3)', color: saving ? 'var(--t3)' : saved ? 'var(--green)' : 'var(--t2)', border: '1px solid var(--border-md)' }}>
          {saving ? 'Menyimpan...' : saved ? '✓ Tersimpan' : '💾 Simpan'}
        </button>

        <button onClick={goLive}
          className="px-4 py-1.5 rounded-lg text-[12px] font-semibold text-white"
          style={{ background: 'var(--green)', boxShadow: '0 0 12px rgba(16,185,129,0.3)' }}>
          🚀 Go Live
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Left toolbar */}
        <div className="w-12 flex flex-col items-center py-3 gap-1 flex-shrink-0"
          style={{ background: 'var(--bg-1)', borderRight: '1px solid var(--border)' }}>
          {([
            { t: 'select' as Tool, icon: '↖', tip: 'Pilih (V)' },
            { t: 'draw' as Tool, icon: '⬜', tip: 'Gambar (R)' },
            { t: 'delete' as Tool, icon: '🗑', tip: 'Hapus (D)' },
          ]).map(({ t, icon, tip }) => (
            <button key={t} onClick={() => setTool(t)} title={tip}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[15px] transition-all"
              style={{
                background: tool === t ? 'var(--accent-sub)' : 'transparent',
                border: tool === t ? '1px solid rgba(124,58,237,0.3)' : '1px solid transparent',
                color: tool === t ? 'var(--accent-2)' : 'var(--t3)',
              }}>
              {icon}
            </button>
          ))}
          <div className="w-6 h-px my-1" style={{ background: 'var(--border)' }} />
          <div className="text-center" style={{ color: 'var(--t3)' }}>
            <div className="text-[10px] mb-1">{units.length}</div>
            <div className="text-[8px]">unit</div>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 overflow-hidden relative">
          <MapCanvas
            units={units} onChange={setUnits}
            selectedId={selectedId} onSelect={setSelectedId}
            tool={tool}
          />
          {digitizing && (
            <div className="absolute inset-0 flex items-center justify-center"
              style={{ background: 'rgba(8,10,16,0.7)' }}>
              <div className="text-center">
                <div className="text-3xl mb-3 animate-pulse">🤖</div>
                <p className="text-sm font-medium" style={{ color: 'var(--t1)' }}>Gemini sedang menganalisis denah...</p>
                <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>Biasanya 5–15 detik</p>
              </div>
            </div>
          )}
        </div>

        {/* Right config panel */}
        <div className="w-[280px] flex flex-col flex-shrink-0 overflow-hidden"
          style={{ background: 'var(--bg-1)', borderLeft: '1px solid var(--border)' }}>

          {/* Config tabs */}
          <div className="flex border-b flex-shrink-0 overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
            {([
              { key: 'type', label: 'Tipe' },
              { key: 'urgency', label: 'Urgensi' },
              { key: 'subcontractor', label: 'Subkon' },
              { key: 'spk', label: 'SPK' },
              { key: 'supervisor', label: 'Pengawas' },
            ] as { key: ConfigTab; label: string }[]).map(tab => (
              <button key={tab.key} onClick={() => setConfigTab(tab.key)}
                className="flex-1 py-2.5 text-[11px] font-medium whitespace-nowrap transition-colors"
                style={{
                  color: configTab === tab.key ? 'var(--accent-2)' : 'var(--t3)',
                  borderBottom: configTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                }}>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4">

            {/* Selected unit info */}
            {selected && (
              <div className="mb-4 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
                <p className="text-[10px] font-semibold tracking-widest uppercase mb-2" style={{ color: 'var(--t3)' }}>
                  Unit Dipilih
                </p>
                <div className="flex gap-2 mb-2">
                  <input value={unitCode}
                    onChange={e => setUnitCode(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                    onBlur={() => updateSelected({ unit_code: unitCode })}
                    placeholder="Kode"
                    className="flex-1 px-2 py-1.5 rounded text-[12px] font-mono outline-none"
                    style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
                  <input value={unitLabel}
                    onChange={e => setUnitLabel(e.target.value)}
                    onBlur={() => updateSelected({ label: unitLabel || undefined })}
                    placeholder="Label"
                    className="flex-1 px-2 py-1.5 rounded text-[12px] outline-none"
                    style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
                </div>
                <button onClick={() => { setUnits(p => p.filter(u => u.id !== selectedId)); setSelectedId(null) }}
                  className="w-full py-1.5 rounded text-[11px] font-medium"
                  style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  Hapus Unit
                </button>
              </div>
            )}

            {!selected && (
              <p className="text-[12px] text-center py-4" style={{ color: 'var(--t3)' }}>
                Pilih unit di kanvas untuk mengkonfigurasi
              </p>
            )}

            {/* Tab: Tipe */}
            {configTab === 'type' && selected && (
              <div className="grid grid-cols-2 gap-2">
                {UNIT_TYPES.map(ut => (
                  <button key={ut.value} onClick={() => updateSelected({ unit_type: ut.value })}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] text-left"
                    style={{
                      background: selected.unit_type === ut.value ? 'var(--accent-sub)' : 'var(--bg-2)',
                      border: selected.unit_type === ut.value ? '1px solid rgba(124,58,237,0.4)' : '1px solid var(--border)',
                      color: selected.unit_type === ut.value ? 'var(--accent-2)' : 'var(--t2)',
                    }}>
                    <span>{ut.icon}</span><span>{ut.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Tab: Urgensi */}
            {configTab === 'urgency' && selected && (
              <div className="space-y-2">
                {URGENCY_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => updateSelected({ urgency: opt.value as 'normal' | 'high' | 'critical' })}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium"
                    style={{
                      background: selected.urgency === opt.value ? 'var(--bg-3)' : 'var(--bg-2)',
                      border: `1px solid ${selected.urgency === opt.value ? opt.color : 'var(--border)'}`,
                      color: selected.urgency === opt.value ? opt.color : 'var(--t2)',
                    }}>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: opt.color }} />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {/* Tab: Subkontraktor */}
            {configTab === 'subcontractor' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input value={subName} onChange={e => setSubName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addSub()}
                    placeholder="Nama subkon..."
                    className="flex-1 px-2.5 py-1.5 rounded text-[12px] outline-none"
                    style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
                  <button onClick={addSub}
                    className="px-3 py-1.5 rounded text-[12px] font-semibold text-white"
                    style={{ background: 'var(--accent)' }}>+</button>
                </div>
                {subs.map((s, i) => (
                  <button key={i} onClick={() => selected && updateSelected({ subcontractor_color: s.color })}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[12px]"
                    style={{
                      background: selected?.subcontractor_color === s.color ? 'var(--bg-3)' : 'var(--bg-2)',
                      border: `1px solid ${selected?.subcontractor_color === s.color ? s.color : 'var(--border)'}`,
                      color: 'var(--t1)',
                    }}>
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: s.color }} />
                    {s.name}
                  </button>
                ))}
                {subs.length === 0 && (
                  <p className="text-[11px] text-center" style={{ color: 'var(--t3)' }}>
                    Tambahkan subkontraktor di atas
                  </p>
                )}
              </div>
            )}

            {/* Tab: SPK */}
            {configTab === 'spk' && (
              <div>
                <p className="text-[11px] mb-3" style={{ color: 'var(--t3)' }}>
                  Template SPK tersedia setelah dibuat di menu SPK.
                </p>
                <Link href="/spk"
                  className="block w-full text-center py-2 rounded-lg text-[12px] font-medium"
                  style={{ background: 'var(--accent-sub)', color: 'var(--accent-2)', border: '1px solid rgba(124,58,237,0.3)' }}>
                  Kelola Template SPK →
                </Link>
              </div>
            )}

            {/* Tab: Pengawas */}
            {configTab === 'supervisor' && (
              <div>
                <p className="text-[11px]" style={{ color: 'var(--t3)' }}>
                  Penugasan pengawas tersedia setelah proyek Go Live.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
