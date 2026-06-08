'use client'

import { useState, useEffect, useCallback, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import MapCanvas, { CanvasUnit, UnitType, GridRect, Tool } from '@/components/map/MapCanvas'
import {
  validateUnitCodes,
  generateGridCodes,
  parseSkipList,
  type ValidationIssue,
} from '@/lib/digitize/numbering'
type ConfigTab = 'type' | 'urgency' | 'subcontractor' | 'spk' | 'supervisor'

interface MapDraft {
  units: CanvasUnit[]
  skipNumbers?: number[]
  savedAt: string
}


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

// Infrastructure (roads, fasos/fasum, parking, etc.) is not a sellable unit and
// must not be tallied in the unit count.
const INFRASTRUCTURE_TYPES = new Set<UnitType>([
  'road', 'common_area', 'parking', 'facility', 'drainage', 'boundary',
])
const isSellableUnit = (u: CanvasUnit) => !INFRASTRUCTURE_TYPES.has(u.unit_type)
const countSellableUnits = (units: CanvasUnit[]) => units.filter(isSellableUnit).length

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
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [planRotation, setPlanRotation] = useState(0)
  const [detectCount, setDetectCount] = useState<number | null>(null)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [detectDiag, setDetectDiag] = useState<{ model: string | null; grids: number; areas: number } | null>(null)
  const [gridRect, setGridRect] = useState<GridRect | null>(null)
  const [gridRows, setGridRows] = useState('2')
  const [gridCols, setGridCols] = useState('10')
  const [gridPrefix, setGridPrefix] = useState('A')
  const [gridStart, setGridStart] = useState('1')
  const [gridSkip, setGridSkip] = useState('')
  // Project-wide intentionally-skipped numbers (e.g. 4, 13, 14) so validation
  // doesn't flag them as missing.
  const [skipNumbers, setSkipNumbers] = useState<number[]>([])
  const [subName, setSubName] = useState('')
  const [subs, setSubs] = useState<{ name: string; color: string }[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [draftUnits, setDraftUnits] = useState<CanvasUnit[] | null>(null)
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([])
  const initialUnitsRef = useRef<CanvasUnit[] | null>(null)
  const draftKey = `pantau_map_${id}`

  const selected = units.find(u => u.id === selectedId) ?? null

  // Load project, then check for unsaved localStorage draft
  useEffect(() => {
    fetch(`/api/v1/projects/${id}`)
      .then(r => r.json())
      .then(j => {
        if (!j.data) return
        setProject({ name: j.data.name, project_code: j.data.project_code })
        const serverUnits: CanvasUnit[] = j.data.canvas_data?.units ?? []
        setUnits(serverUnits)
        initialUnitsRef.current = serverUnits
        if (Array.isArray(j.data.canvas_data?.skipNumbers)) {
          setSkipNumbers(j.data.canvas_data.skipNumbers)
        }

        try {
          const raw = localStorage.getItem(`pantau_map_${id}`)
          if (raw) {
            const draft = JSON.parse(raw) as MapDraft
            if (draft.units?.length > 0) {
              setDraftUnits(draft.units)
              setDraftSavedAt(draft.savedAt)
            }
          }
        } catch {}
      })
  }, [id])

  function updateSelected(patch: Partial<CanvasUnit>) {
    if (!selectedId) return
    setIsDirty(true)
    setUnits(prev => prev.map(u => u.id === selectedId ? { ...u, ...patch } : u))
  }

  const save = useCallback(async () => {
    setSaving(true)
    const res = await fetch(`/api/v1/projects/${id}/map/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canvas_data: { units, skipNumbers } }),
    })
    if (res.ok) {
      setIsDirty(false)
      try { localStorage.removeItem(`pantau_map_${id}`) } catch {}
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [id, units, skipNumbers])

  // Ctrl+S to save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save() }
      if (e.key === 'v') setTool('select')
      if (e.key === 'r') setTool('draw')
      if (e.key === 'g') setTool('grid')
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

  // Autosave to localStorage — fires 1.5 s after any user-initiated change
  useEffect(() => {
    if (units === initialUnitsRef.current) return
    if (!isDirty) return
    const timer = setTimeout(() => {
      try {
        const draft: MapDraft = { units, savedAt: new Date().toISOString() }
        localStorage.setItem(draftKey, JSON.stringify(draft))
      } catch {}
    }, 1500)
    return () => clearTimeout(timer)
  }, [units, isDirty, draftKey])

  // Validation runs on every units change (skip-aware)
  useEffect(() => {
    setValidationIssues(validateUnitCodes(units.map(u => u.unit_code), skipNumbers))
  }, [units, skipNumbers])

  // Warn before tab close / hard navigation when dirty
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  async function handleDigitize(file: File, rotation = planRotation) {
    setSourceFile(file)
    setDigitizing(true)
    setDetectCount(null)
    setDetectError(null)
    setDetectDiag(null)

    try {
      const imageForAnalysis = await prepareImageForAnalysis(file, rotation)

      // Show the exact image sent to Gemini so returned coordinates line up.
      setBgImageUrl(URL.createObjectURL(imageForAnalysis))

      const fd = new FormData()
      fd.append('image', imageForAnalysis)
      const res = await fetch(`/api/v1/projects/${id}/map/digitize`, { method: 'POST', body: fd })
      const json = await res.json()

      if (!res.ok) {
        setDetectError(json.error?.message ?? `Server error ${res.status}`)
        setDigitizing(false)
        return
      }

      const detected: Array<{
        temp_id: string; suggested_code: string; type: UnitType;
        coordinates: { x: number; y: number; width: number; height: number }
        label_detected: string | null
        rotation_degrees?: number
      }> = json.data?.detected_units ?? []

      const diag = json.data?.diagnostics
      if (diag) {
        setDetectDiag({
          model: diag.model ?? null,
          grids: diag.grids_detected ?? 0,
          areas: diag.non_grid_areas ?? 0,
        })
      }

      if (detected.length > 0) {
        const mapped: CanvasUnit[] = detected.map(d => ({
          id: d.temp_id,
          unit_code: d.suggested_code ?? d.temp_id,
          unit_type: d.type ?? 'house',
          x: d.coordinates.x, y: d.coordinates.y,
          width: d.coordinates.width, height: d.coordinates.height,
          rotation: normaliseDegrees(d.rotation_degrees ?? 0),
          label: d.label_detected ?? undefined,
        }))
        setIsDirty(true)
        setUnits(mapped)
        setDetectCount(countSellableUnits(mapped))
      } else {
        setDetectCount(0)
      }
    } catch {
      setDetectError('Koneksi gagal — periksa internet dan coba lagi')
    }

    setDigitizing(false)
  }

  function handleGridConfirm() {
    if (!gridRect) return
    const rows = Math.max(1, parseInt(gridRows) || 1)
    const cols = Math.max(1, parseInt(gridCols) || 1)
    const start = parseInt(gridStart) || 1
    const prefix = gridPrefix.trim() || 'U'
    const skip = parseSkipList(gridSkip)

    const unitW = gridRect.width / cols
    const unitH = gridRect.height / rows
    // Generate codes up front so skipped numbers (e.g. 4, 13, 14) are honoured.
    const codes = generateGridCodes({ prefix, start, count: rows * cols, skip })
    const stamp = Date.now()
    const newUnits: CanvasUnit[] = []

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c
        newUnits.push({
          id: `grid_${stamp}_${r}_${c}`,
          unit_code: codes[idx],
          unit_type: 'house',
          x: gridRect.x + c * unitW,
          y: gridRect.y + r * unitH,
          width: unitW,
          height: unitH,
          rotation: 0,
        })
      }
    }

    // Remember the skips so validation won't flag them as gaps.
    if (skip.length > 0) {
      setSkipNumbers(prev => [...new Set([...prev, ...skip])].sort((a, b) => a - b))
    }
    setIsDirty(true)
    setUnits(prev => [...prev, ...newUnits])
    setGridRect(null)
    setTool('select')
  }

  function addSub() {
    if (!subName.trim()) return
    const color = SUB_COLORS[subs.length % SUB_COLORS.length]
    setSubs(prev => [...prev, { name: subName.trim(), color }])
    setSubName('')
  }

  function deleteSub(index: number) {
    const removed = subs[index]
    if (!removed) return
    setSubs(prev => prev.filter((_, i) => i !== index))
    // Unassign this subkon's colour from any units that were assigned to it.
    setUnits(prev => prev.map(u =>
      u.subcontractor_color === removed.color ? { ...u, subcontractor_color: undefined } : u
    ))
    setIsDirty(true)
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

        {sourceFile && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
            <span className="text-[10px]" style={{ color: 'var(--t3)' }}>Kemiringan</span>
            <button onClick={() => setPlanRotation(r => roundAngle(r - 1))}
              className="px-1.5 py-0.5 rounded text-[11px]"
              style={{ background: 'var(--bg-3)', color: 'var(--t2)' }}>
              -1°
            </button>
            <input type="number" step="0.5" value={planRotation}
              onChange={e => setPlanRotation(roundAngle(Number(e.target.value) || 0))}
              className="w-14 px-1.5 py-0.5 rounded text-[11px] font-mono text-center outline-none"
              style={{ background: 'var(--bg-3)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
            <button onClick={() => setPlanRotation(r => roundAngle(r + 1))}
              className="px-1.5 py-0.5 rounded text-[11px]"
              style={{ background: 'var(--bg-3)', color: 'var(--t2)' }}>
              +1°
            </button>
            <button onClick={() => handleDigitize(sourceFile, planRotation)} disabled={digitizing}
              className="px-2 py-0.5 rounded text-[11px] font-medium"
              style={{ background: 'var(--accent-sub)', color: 'var(--accent-2)', border: '1px solid rgba(124,58,237,0.25)' }}>
              Analisis ulang
            </button>
          </div>
        )}

        {/* Upload site plan */}
        <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer"
          style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>
          {digitizing ? '⏳ Menganalisis...' : '📂 Upload Denah'}
          <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.heic,.pdf"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleDigitize(file, planRotation)
              e.currentTarget.value = ''
            }} />
        </label>

        <button onClick={save} disabled={saving}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium"
          style={{
            background: 'var(--bg-3)',
            color: saving ? 'var(--t3)' : saved ? 'var(--green)' : isDirty ? 'var(--amber)' : 'var(--t2)',
            border: `1px solid ${isDirty && !saving && !saved ? 'rgba(245,158,11,0.4)' : 'var(--border-md)'}`,
          }}>
          {saving ? 'Menyimpan...' : saved ? '✓ Tersimpan' : isDirty ? '● Belum disimpan' : '💾 Simpan'}
        </button>

        <button onClick={goLive}
          className="px-4 py-1.5 rounded-lg text-[12px] font-semibold text-white"
          style={{ background: 'var(--green)', boxShadow: '0 0 12px rgba(16,185,129,0.3)' }}>
          🚀 Go Live
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Left toolbar */}
        <div className="w-16 flex flex-col items-center py-3 gap-1 flex-shrink-0"
          style={{ background: 'var(--bg-1)', borderRight: '1px solid var(--border)' }}>
          {([
            { t: 'select' as Tool, icon: '↖', label: 'Pilih',  tip: 'Pilih & geser (V)' },
            { t: 'draw'   as Tool, icon: '✏️', label: 'Gambar', tip: 'Gambar unit (R)' },
            { t: 'grid'   as Tool, icon: '▦',  label: 'Grid',   tip: 'Grid blok otomatis (G)' },
            { t: 'delete' as Tool, icon: '🗑',  label: 'Hapus',  tip: 'Hapus unit (D)' },
          ]).map(({ t, icon, label, tip }) => (
            <button key={t} onClick={() => setTool(t)} title={tip}
              className="w-14 flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-all"
              style={{
                background: tool === t ? 'var(--accent-sub)' : 'transparent',
                border: tool === t ? '1px solid rgba(124,58,237,0.3)' : '1px solid transparent',
                color: tool === t ? 'var(--accent-2)' : 'var(--t3)',
              }}>
              <span className="text-[16px] leading-none">{icon}</span>
              <span className="text-[9px] font-medium leading-none">{label}</span>
            </button>
          ))}

          <div className="w-8 h-px my-1" style={{ background: 'var(--border)' }} />

          <div className="text-center px-1">
            <div className="text-[13px] font-bold" style={{ color: 'var(--t1)' }}>{countSellableUnits(units)}</div>
            <div className="text-[8px]" style={{ color: 'var(--t3)' }}>unit</div>
            {units.length > countSellableUnits(units) && (
              <div className="text-[8px] mt-0.5" style={{ color: 'var(--t3)' }}>
                +{units.length - countSellableUnits(units)} area
              </div>
            )}
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 overflow-hidden relative">

          {/* Draft recovery banner */}
          {draftUnits && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium"
              style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.5)', color: 'var(--amber)', backdropFilter: 'blur(8px)', whiteSpace: 'nowrap' }}>
              <span>💾 Ditemukan draft yang belum disimpan ({draftSavedAt ? new Date(draftSavedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '?'})</span>
              <button onClick={() => { setIsDirty(true); setUnits(draftUnits); setDraftUnits(null) }}
                className="px-3 py-1 rounded-lg text-xs font-semibold"
                style={{ background: 'rgba(245,158,11,0.3)', color: 'var(--amber)' }}>
                Pulihkan
              </button>
              <button onClick={() => { setDraftUnits(null); try { localStorage.removeItem(draftKey) } catch {} }}
                className="opacity-60 hover:opacity-100 text-xs">
                Abaikan ×
              </button>
            </div>
          )}

          <MapCanvas
            units={units} onChange={(u) => { setIsDirty(true); setUnits(u) }}
            selectedId={selectedId} onSelect={setSelectedId}
            tool={tool}
            bgImageUrl={bgImageUrl ?? undefined}
            onGridRect={rect => { setGridRect(rect); setGridPrefix('A'); setGridRows('2'); setGridCols('10') }}
          />

          {/* Block Grid config panel */}
          {gridRect && (
            <div className="absolute inset-0 flex items-center justify-center"
              style={{ background: 'rgba(8,10,16,0.6)', backdropFilter: 'blur(2px)' }}>
              <div className="rounded-xl p-5 w-72"
                style={{ background: 'var(--bg-1)', border: '1px solid var(--border-md)' }}>
                <h3 className="font-semibold text-sm mb-1" style={{ color: 'var(--t1)' }}>⊞ Buat Grid Blok</h3>
                <p className="text-[11px] mb-4" style={{ color: 'var(--t3)' }}>
                  Isi area yang digambar dengan grid unit berlabel otomatis
                </p>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-[11px] mb-1" style={{ color: 'var(--t2)' }}>Baris</label>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setGridRows(r => String(Math.max(1, (parseInt(r) || 1) - 1)))}
                        className="px-2 py-1.5 rounded text-sm font-bold"
                        style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>−</button>
                      <input type="number" min="1" max="50" value={gridRows}
                        onChange={e => setGridRows(e.target.value)}
                        className="flex-1 px-1 py-1.5 rounded text-sm outline-none text-center font-mono"
                        style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
                      <button onClick={() => setGridRows(r => String(Math.min(50, (parseInt(r) || 1) + 1)))}
                        className="px-2 py-1.5 rounded text-sm font-bold"
                        style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>+</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] mb-1" style={{ color: 'var(--t2)' }}>Kolom</label>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setGridCols(c => String(Math.max(1, (parseInt(c) || 1) - 1)))}
                        className="px-2 py-1.5 rounded text-sm font-bold"
                        style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>−</button>
                      <input type="number" min="1" max="100" value={gridCols}
                        onChange={e => setGridCols(e.target.value)}
                        className="flex-1 px-1 py-1.5 rounded text-sm outline-none text-center font-mono"
                        style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
                      <button onClick={() => setGridCols(c => String(Math.min(100, (parseInt(c) || 1) + 1)))}
                        className="px-2 py-1.5 rounded text-sm font-bold"
                        style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>+</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] mb-1" style={{ color: 'var(--t2)' }}>Prefiks (cth. 3J, F, G)</label>
                    <input type="text" maxLength={5} value={gridPrefix}
                      onChange={e => setGridPrefix(e.target.value.toUpperCase())}
                      placeholder="3J"
                      className="w-full px-2.5 py-1.5 rounded text-sm outline-none text-center font-mono"
                      style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
                  </div>
                  <div>
                    <label className="block text-[11px] mb-1" style={{ color: 'var(--t2)' }}>Mulai dari nomor</label>
                    <input type="number" min="1" value={gridStart}
                      onChange={e => setGridStart(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded text-sm outline-none text-center font-mono"
                      style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
                  </div>
                  <div>
                    <label className="block text-[11px] mb-1" style={{ color: 'var(--t2)' }}>Lewati nomor (cth. 4, 13, 14)</label>
                    <input type="text" value={gridSkip}
                      onChange={e => setGridSkip(e.target.value)}
                      placeholder="kosongkan jika tidak ada"
                      className="w-full px-2.5 py-1.5 rounded text-sm outline-none text-center font-mono"
                      style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
                  </div>
                </div>

                {(() => {
                  const total = (parseInt(gridRows) || 1) * (parseInt(gridCols) || 1)
                  const preview = generateGridCodes({
                    prefix: gridPrefix.trim() || 'U',
                    start: parseInt(gridStart) || 1,
                    count: total,
                    skip: parseSkipList(gridSkip),
                  })
                  return (
                    <p className="text-[11px] mb-4 text-center" style={{ color: 'var(--accent-2)' }}>
                      → {total} unit: {preview[0]} s/d {preview[preview.length - 1]}
                    </p>
                  )
                })()}

                <div className="flex gap-2">
                  <button onClick={() => setGridRect(null)}
                    className="flex-1 py-2 rounded-lg text-xs font-medium"
                    style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>
                    Batal
                  </button>
                  <button onClick={handleGridConfirm}
                    className="flex-1 py-2 rounded-lg text-xs font-semibold text-white"
                    style={{ background: 'var(--accent)', boxShadow: '0 0 12px var(--accent-glow)' }}>
                    Buat Grid
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Validation issues panel */}
          {validationIssues.length > 0 && !gridRect && !digitizing && (
            <div className="absolute bottom-14 right-4 max-w-xs z-10">
              <div className="rounded-xl p-3 text-[11px] space-y-1.5"
                style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', backdropFilter: 'blur(8px)' }}>
                <p className="font-semibold" style={{ color: 'var(--amber)' }}>⚠ Periksa kode unit</p>
                {validationIssues.slice(0, 4).map((issue, i) => (
                  <p key={i} style={{ color: 'var(--t2)' }}>
                    {issue.type === 'duplicate' && `Duplikat: ${issue.codes.slice(0, 3).join(', ')}`}
                    {issue.type === 'gap' && `${issue.prefix}: hilang ${issue.gaps.slice(0, 3).join(', ')}`}
                    {issue.type === 'missing_suffix' && `Mungkin hilang: ${issue.missing}`}
                  </p>
                ))}
                {validationIssues.length > 4 && (
                  <p style={{ color: 'var(--t3)' }}>+{validationIssues.length - 4} masalah lainnya</p>
                )}
              </div>
            </div>
          )}

          {/* Grid tool hint */}
          {tool === 'grid' && !gridRect && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-[12px] font-medium pointer-events-none"
              style={{ background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)', color: 'var(--accent-2)', backdropFilter: 'blur(8px)' }}>
              ▦ Klik dan seret di atas area blok untuk membuat grid unit otomatis
            </div>
          )}

          {/* Gemini loading overlay */}
          {digitizing && (
            <div className="absolute inset-0 flex items-center justify-center"
              style={{ background: 'rgba(8,10,16,0.75)' }}>
              <div className="text-center">
                <div className="text-3xl mb-3 animate-pulse">🤖</div>
                <p className="text-sm font-medium" style={{ color: 'var(--t1)' }}>Gemini sedang menganalisis denah...</p>
                <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>Biasanya 5–15 detik</p>
              </div>
            </div>
          )}

          {/* Detection result / error banner */}
          {(detectCount !== null || detectError) && !digitizing && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium flex items-start gap-2 max-w-lg"
              style={{
                background: detectError ? 'rgba(239,68,68,0.15)' : detectCount! > 0 ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                border: `1px solid ${detectError ? 'rgba(239,68,68,0.4)' : detectCount! > 0 ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)'}`,
                color: detectError ? 'var(--red)' : detectCount! > 0 ? 'var(--green)' : 'var(--amber)',
                backdropFilter: 'blur(8px)',
              }}>
              {detectError
                ? `✕ Error: ${detectError}`
                : detectCount! > 0
                  ? `✓ Gemini (${detectDiag?.model ?? 'AI'}) mendeteksi ${detectCount} unit — periksa & sesuaikan, lalu simpan`
                  : detectDiag
                    ? `⚠ AI tidak menemukan blok unit (${detectDiag.model ?? 'model'}: ${detectDiag.grids} grid, ${detectDiag.areas} area). Coba foto lebih jelas, atau pakai alat Grid manual.`
                    : '⚠ Tidak ada unit terdeteksi — coba foto lebih jelas, atau pakai alat Grid manual.'}
              <button onClick={() => { setDetectCount(null); setDetectError(null); setDetectDiag(null) }}
                className="ml-2 opacity-60 hover:opacity-100 flex-shrink-0">×</button>
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
                  <input value={selected.unit_code}
                    onChange={e => updateSelected({ unit_code: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })}
                    placeholder="Kode"
                    className="flex-1 px-2 py-1.5 rounded text-[12px] font-mono outline-none"
                    style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
                  <input value={selected.label ?? ''}
                    onChange={e => updateSelected({ label: e.target.value || undefined })}
                    placeholder="Label"
                    className="flex-1 px-2 py-1.5 rounded text-[12px] outline-none"
                    style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
                </div>
                <div className="mb-2">
                  <label className="block text-[10px] mb-1" style={{ color: 'var(--t3)' }}>Rotasi unit</label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateSelected({ rotation: roundAngle((selected.rotation ?? 0) - 1) })}
                      className="px-2 py-1 rounded text-[11px]"
                      style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t2)' }}>
                      -1°
                    </button>
                    <input type="number" step="0.5" value={selected.rotation ?? 0}
                      onChange={e => updateSelected({ rotation: normaliseDegrees(Number(e.target.value) || 0) })}
                      className="flex-1 px-2 py-1 rounded text-[12px] font-mono text-center outline-none"
                      style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
                    <button onClick={() => updateSelected({ rotation: roundAngle((selected.rotation ?? 0) + 1) })}
                      className="px-2 py-1 rounded text-[11px]"
                      style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t2)' }}>
                      +1°
                    </button>
                    <button onClick={() => updateSelected({ rotation: 0 })}
                      className="px-2 py-1 rounded text-[11px]"
                      style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t3)' }}>
                      Reset
                    </button>
                  </div>
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
                {subs.map((s, i) => {
                  const assignedCount = units.filter(u => u.subcontractor_color === s.color).length
                  return (
                    <div key={i} className="flex items-center gap-1.5">
                      <button onClick={() => selected && updateSelected({ subcontractor_color: s.color })}
                        className="flex-1 flex items-center gap-3 px-3 py-2 rounded-lg text-[12px]"
                        style={{
                          background: selected?.subcontractor_color === s.color ? 'var(--bg-3)' : 'var(--bg-2)',
                          border: `1px solid ${selected?.subcontractor_color === s.color ? s.color : 'var(--border)'}`,
                          color: 'var(--t1)',
                        }}>
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: s.color }} />
                        <span className="flex-1 text-left truncate">{s.name}</span>
                        {assignedCount > 0 && (
                          <span className="text-[10px] font-mono flex-shrink-0" style={{ color: 'var(--t3)' }}>{assignedCount}</span>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          if (assignedCount === 0 || confirm(`Hapus "${s.name}"? ${assignedCount} unit akan kehilangan subkon.`)) {
                            deleteSub(i)
                          }
                        }}
                        title="Hapus subkon"
                        className="px-2 py-2 rounded-lg text-[12px] flex-shrink-0"
                        style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.2)' }}>
                        ×
                      </button>
                    </div>
                  )
                })}
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

function roundAngle(value: number): number {
  return Math.round(normaliseDegrees(value) * 10) / 10
}

function normaliseDegrees(value: number): number {
  if (!Number.isFinite(value)) return 0
  let angle = value % 360
  if (angle > 180) angle -= 360
  if (angle < -180) angle += 360
  return angle
}

async function prepareImageForAnalysis(file: File, rotation: number): Promise<File> {
  const angle = roundAngle(rotation)
  if (file.type === 'application/pdf' || Math.abs(angle) < 0.01) return file

  const imageUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(imageUrl)
    const radians = angle * Math.PI / 180
    const sin = Math.abs(Math.sin(radians))
    const cos = Math.abs(Math.cos(radians))
    const width = image.naturalWidth
    const height = image.naturalHeight
    const rotatedWidth = Math.ceil(width * cos + height * sin)
    const rotatedHeight = Math.ceil(width * sin + height * cos)
    const canvas = document.createElement('canvas')
    canvas.width = rotatedWidth
    canvas.height = rotatedHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available')

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rotatedWidth, rotatedHeight)
    ctx.translate(rotatedWidth / 2, rotatedHeight / 2)
    ctx.rotate(radians)
    ctx.drawImage(image, -width / 2, -height / 2)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('Could not rotate image')), 'image/jpeg', 0.92)
    })

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'denah'
    return new File([blob], `${baseName}-rotated.jpg`, { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(imageUrl)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load image for rotation'))
    image.src = src
  })
}
