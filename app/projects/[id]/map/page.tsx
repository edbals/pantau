'use client'

import { useState, useEffect, useCallback, useMemo, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import MapCanvas, { CanvasUnit, UnitType, GridRect, Tool } from '@/components/map/MapCanvas'
import GridSizePicker from '@/components/map/GridSizePicker'
import StudioStepsHud, { type StudioStep } from '@/components/map/StudioStepsHud'
import {
  validateUnitCodes,
  generateGridCodes,
  parseSkipList,
} from '@/lib/digitize/numbering'
import { tidyLayout } from '@/lib/digitize/tidy-layout'
// SPK templates are managed separately at /spk, not inside the denah editor.
type ConfigTab = 'type' | 'urgency' | 'subcontractor' | 'supervisor'

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
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [tool, setTool] = useState<Tool>('select')
  const [snapEnabled, setSnapEnabled] = useState(true)
  // Render-frame aspect (w/h) reported by the canvas; keeps tidied lots square.
  const [imageAspect, setImageAspect] = useState(1)
  const [tidying, setTidying] = useState(false)
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
  const validationIssues = useMemo(
    () => validateUnitCodes(units.map(u => u.unit_code), skipNumbers),
    [units, skipNumbers]
  )
  const initialUnitsRef = useRef<CanvasUnit[] | null>(null)
  const draftKey = `pantau_map_${id}`

  const selectedSet = new Set(selectedIds)
  const selectedUnits = units.filter(u => selectedSet.has(u.id))
  // The detail panel only makes sense for exactly one unit.
  const selected = selectedUnits.length === 1 ? selectedUnits[0] : null

  // Returns the value shared by every selected unit for a field, or null if
  // they differ — used to highlight the active option in batch mode.
  function commonValue<T>(getter: (u: CanvasUnit) => T): T | null {
    if (selectedUnits.length === 0) return null
    const first = getter(selectedUnits[0])
    return selectedUnits.every(u => getter(u) === first) ? first : null
  }

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
        if (Array.isArray(j.data.canvas_data?.subs)) {
          setSubs(j.data.canvas_data.subs)
        }

        try {
          const raw = localStorage.getItem(`pantau_map_${id}`)
          if (raw) {
            const draft = JSON.parse(raw) as MapDraft
            // Only offer recovery when the draft actually differs from what was
            // just loaded from the server — otherwise it's redundant noise.
            const differs = JSON.stringify(draft.units ?? []) !== JSON.stringify(serverUnits)
            const dismissed = sessionStorage.getItem(`pantau_map_dismiss_${id}`) === draft.savedAt
            if (draft.units?.length > 0 && differs && !dismissed) {
              setDraftUnits(draft.units)
              setDraftSavedAt(draft.savedAt)
            } else if (!differs) {
              // Draft matches server — clear the stale copy.
              localStorage.removeItem(`pantau_map_${id}`)
            }
          }
        } catch {}
      })
  }, [id])

  // ── Undo / redo (coalesces rapid changes such as drags into one step) ──
  const undoStack = useRef<CanvasUnit[][]>([])
  const redoStack = useRef<CanvasUnit[][]>([])
  const histBaseline = useRef<CanvasUnit[] | null>(null)
  const skipHistory = useRef(false)
  // True while a tidy-layout tween is running: intermediate frames must not push
  // history (the whole tween commits as one undo step when it settles).
  const animating = useRef(false)
  const tidyRaf = useRef<number | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const syncHistFlags = () => {
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(redoStack.current.length > 0)
  }

  useEffect(() => {
    // During a tidy tween, track the latest frame as baseline but never push —
    // the tween commits a single history entry itself when it finishes.
    if (animating.current) { histBaseline.current = units; return }
    if (skipHistory.current) { skipHistory.current = false; histBaseline.current = units; return }
    if (histBaseline.current === null) { histBaseline.current = units; return }
    if (histBaseline.current === units) return
    const t = setTimeout(() => {
      if (histBaseline.current && histBaseline.current !== units) {
        undoStack.current.push(histBaseline.current)
        if (undoStack.current.length > 50) undoStack.current.shift()
        redoStack.current = []
        histBaseline.current = units
        syncHistFlags()
      }
    }, 450)
    return () => clearTimeout(t)
  }, [units])

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return
    redoStack.current.push(units)
    const prev = undoStack.current.pop()!
    skipHistory.current = true
    histBaseline.current = prev
    setUnits(prev)
    setSelectedIds([])
    setIsDirty(true)
    syncHistFlags()
  }, [units])

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return
    undoStack.current.push(units)
    const next = redoStack.current.pop()!
    skipHistory.current = true
    histBaseline.current = next
    setUnits(next)
    setSelectedIds([])
    setIsDirty(true)
    syncHistFlags()
  }, [units])

  // Applies a patch to every selected unit (works for 1 or many).
  function updateSelected(patch: Partial<CanvasUnit>) {
    if (selectedIds.length === 0) return
    setIsDirty(true)
    setUnits(prev => prev.map(u => selectedSet.has(u.id) ? { ...u, ...patch } : u))
  }

  function deleteSelected() {
    if (selectedIds.length === 0) return
    setIsDirty(true)
    setUnits(prev => prev.filter(u => !selectedSet.has(u.id)))
    setSelectedIds([])
  }

  // ── Tidy layout: re-flow blocks into a clean collision-free schematic ──
  const runTidyLayout = useCallback(() => {
    if (tidyRaf.current !== null) return // a tween is already running
    const before = units
    const target = tidyLayout(before, { imageAspect })
    const moved = target !== before && target.some((u, i) => {
      const b = before[i]
      return !b || b.x !== u.x || b.y !== u.y || b.width !== u.width || b.height !== u.height
    })
    if (!moved) return

    setTidying(true)
    animating.current = true
    setSelectedIds([])

    const byId = new Map(before.map(u => [u.id, u]))
    const DURATION = 320
    const startedAt = performance.now()
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / DURATION)
      const k = easeOutCubic(t)
      const frame = target.map(u => {
        const from = byId.get(u.id)
        if (!from) return u
        const lerp = (a: number, b: number) => a + (b - a) * k
        return {
          ...u,
          x: lerp(from.x, u.x),
          y: lerp(from.y, u.y),
          width: lerp(from.width, u.width),
          height: lerp(from.height, u.height),
          rotation: lerp(from.rotation ?? 0, u.rotation ?? 0),
        }
      })
      setUnits(frame)
      if (t < 1) {
        tidyRaf.current = requestAnimationFrame(step)
        return
      }
      // Settle: snap to the exact target and commit one history entry.
      tidyRaf.current = null
      animating.current = false
      skipHistory.current = true // the commit below must not double-push history
      setUnits(target)
      undoStack.current.push(before)
      if (undoStack.current.length > 50) undoStack.current.shift()
      redoStack.current = []
      histBaseline.current = target
      setIsDirty(true)
      setTidying(false)
      syncHistFlags()
    }
    tidyRaf.current = requestAnimationFrame(step)
  }, [units, imageAspect])

  // Cancel any in-flight tidy tween on unmount.
  useEffect(() => () => {
    if (tidyRaf.current !== null) cancelAnimationFrame(tidyRaf.current)
  }, [])

  const save = useCallback(async () => {
    setSaving(true)
    const res = await fetch(`/api/v1/projects/${id}/map/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canvas_data: { units, skipNumbers, subs } }),
    })
    if (res.ok) {
      setIsDirty(false)
      try { localStorage.removeItem(`pantau_map_${id}`) } catch {}
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [id, units, skipNumbers, subs])

  // Ctrl+S to save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); return }
      // Undo / redo (⌘Z, ⌘⇧Z or ⌘Y)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo(); else undo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
      // Don't hijack single-letter shortcuts while typing in a field.
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === 'v') setTool('select')
      if (e.key === 'h') setTool('hand')
      if (e.key === 'r') setTool('draw')
      if (e.key === 'g') setTool('grid')
      if (e.key === 'Escape') setSelectedIds([])
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        setIsDirty(true)
        setUnits(prev => prev.filter(u => !selectedIds.includes(u.id)))
        setSelectedIds([])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, selectedIds, undo, redo])

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
    // Re-analyse is a clean slate: wipe existing units + selection first so the
    // new result fully replaces the old one (and never half-merges on retry).
    setSelectedIds([])
    setUnits([])

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
    setIsDirty(true)
  }

  function renameSub(index: number) {
    const current = subs[index]
    if (!current) return
    const next = prompt('Ganti nama subkontraktor:', current.name)?.trim()
    if (!next || next === current.name) return
    setSubs(prev => prev.map((s, i) => i === index ? { ...s, name: next } : s))
    setIsDirty(true)
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
          {/* Undo / redo */}
          <div className="flex gap-1">
            <button onClick={undo} disabled={!canUndo} title="Urungkan (⌘Z)"
              className="w-[26px] h-7 flex items-center justify-center rounded-lg text-[14px] transition-all"
              style={{ background: 'transparent', color: canUndo ? 'var(--t2)' : 'var(--t3)', opacity: canUndo ? 1 : 0.35 }}>
              ↶
            </button>
            <button onClick={redo} disabled={!canRedo} title="Ulangi (⌘⇧Z)"
              className="w-[26px] h-7 flex items-center justify-center rounded-lg text-[14px] transition-all"
              style={{ background: 'transparent', color: canRedo ? 'var(--t2)' : 'var(--t3)', opacity: canRedo ? 1 : 0.35 }}>
              ↷
            </button>
          </div>

          <div className="w-8 h-px my-1" style={{ background: 'var(--border)' }} />

          {([
            { t: 'hand'   as Tool, icon: '✋', label: 'Geser',  tip: 'Geser peta (H) — atau seret tombol tengah mouse' },
            { t: 'select' as Tool, icon: '⬚', label: 'Pilih',  tip: 'Pilih & seret untuk pilih banyak (V)' },
            { t: 'draw'   as Tool, icon: '✏️', label: 'Gambar', tip: 'Gambar unit (R)' },
            { t: 'grid'   as Tool, icon: '▦',  label: 'Grid',   tip: 'Grid blok otomatis (G)' },
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

          {/* Snap-to-grid toggle */}
          <button onClick={() => setSnapEnabled(s => !s)} title="Snap ke grid (tahan Alt untuk bypass sementara)"
            className="w-14 flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-all"
            style={{
              background: snapEnabled ? 'var(--accent-sub)' : 'transparent',
              border: snapEnabled ? '1px solid rgba(124,58,237,0.3)' : '1px solid transparent',
              color: snapEnabled ? 'var(--accent-2)' : 'var(--t3)',
            }}>
            <span className="text-[16px] leading-none">⊹</span>
            <span className="text-[9px] font-medium leading-none">Snap</span>
          </button>

          {/* Tidy layout — re-flow blocks into a clean, collision-free schematic */}
          <button onClick={runTidyLayout} disabled={tidying || countSellableUnits(units) === 0}
            title="Rapikan tata letak — susun ulang blok jadi grid rapi tanpa tumpang tindih"
            className="w-14 flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-all"
            style={{
              background: 'transparent',
              border: '1px solid transparent',
              color: countSellableUnits(units) === 0 ? 'var(--t3)' : 'var(--accent-2)',
              opacity: tidying || countSellableUnits(units) === 0 ? 0.4 : 1,
            }}>
            <span className="text-[16px] leading-none">{tidying ? '⏳' : '✨'}</span>
            <span className="text-[9px] font-medium leading-none">Rapikan</span>
          </button>

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

          {/* Step-by-step progress HUD */}
          {!gridRect && (() => {
            const sellable = countSellableUnits(units)
            const assignedSubkon = units.filter(u => isSellableUnit(u) && u.subcontractor_color).length
            const steps: StudioStep[] = [
              { key: 'denah', label: 'Denah', done: !!bgImageUrl || units.length > 0 },
              { key: 'unit', label: 'Unit', done: units.length > 0, detail: sellable > 0 ? String(sellable) : undefined, onClick: () => setTool('select') },
              { key: 'subkon', label: 'Subkon', done: sellable > 0 && assignedSubkon === sellable, detail: sellable > 0 ? `${assignedSubkon}/${sellable}` : undefined, onClick: () => setConfigTab('subcontractor') },
              { key: 'prioritas', label: 'Prioritas', optional: true, done: units.some(u => u.urgency && u.urgency !== 'normal'), onClick: () => setConfigTab('urgency') },
              { key: 'golive', label: 'Go Live', done: false, onClick: goLive },
            ]
            return <StudioStepsHud steps={steps} />
          })()}

          {/* Draft recovery banner */}
          {draftUnits && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium"
              style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.5)', color: 'var(--amber)', backdropFilter: 'blur(8px)', whiteSpace: 'nowrap' }}>
              <span>💾 Ditemukan draft yang belum disimpan ({draftSavedAt ? new Date(draftSavedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '?'})</span>
              <button onClick={() => { setIsDirty(true); setUnits(draftUnits); setDraftUnits(null) }}
                className="px-3 py-1 rounded-lg text-xs font-semibold"
                style={{ background: 'rgba(245,158,11,0.3)', color: 'var(--amber)' }}>
                Pulihkan
              </button>
              <button onClick={() => {
                  try {
                    if (draftSavedAt) sessionStorage.setItem(`pantau_map_dismiss_${id}`, draftSavedAt)
                    localStorage.removeItem(draftKey)
                  } catch {}
                  setDraftUnits(null)
                }}
                className="opacity-60 hover:opacity-100 text-xs">
                Abaikan ×
              </button>
            </div>
          )}

          <MapCanvas
            units={units} onChange={(u) => { setIsDirty(true); setUnits(u) }}
            selectedIds={selectedIds} onSelectionChange={setSelectedIds}
            tool={tool} snap={snapEnabled}
            bgImageUrl={bgImageUrl ?? undefined}
            onAspectChange={setImageAspect}
            onGridRect={rect => { setGridRect(rect); setGridPrefix('A'); setGridRows('2'); setGridCols('10') }}
          />

          {/* Shortcuts HUD — mini-Canva hints */}
          {!gridRect && tool === 'select' && (
            <div className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 rounded-lg text-[10px]"
              style={{ background: 'rgba(10,22,40,0.82)', border: '1px solid rgba(95,208,240,0.2)', color: 'rgba(207,232,255,0.75)', backdropFilter: 'blur(8px)', maxWidth: 'calc(100% - 120px)' }}>
              <span><b style={{ color: '#BFEFFF' }}>Seret</b> pilih banyak</span>
              <span><b style={{ color: '#BFEFFF' }}>Shift</b>+klik tambah</span>
              <span><b style={{ color: '#BFEFFF' }}>Delete</b> hapus</span>
              <span><b style={{ color: '#BFEFFF' }}>⌘Z</b> urungkan</span>
              <span><b style={{ color: '#BFEFFF' }}>⌥</b> bebas-snap</span>
              <span><b style={{ color: '#BFEFFF' }}>Scroll</b> zoom</span>
            </div>
          )}

          {/* Block Grid config panel */}
          {gridRect && (
            <div className="absolute inset-0 flex items-center justify-center"
              style={{ background: 'rgba(8,10,16,0.6)', backdropFilter: 'blur(2px)' }}>
              <div className="rounded-xl p-5 w-80 max-h-[90vh] overflow-auto"
                style={{ background: 'var(--bg-1)', border: '1px solid var(--border-md)' }}>
                <h3 className="font-semibold text-sm mb-1" style={{ color: 'var(--t1)' }}>⊞ Buat Grid Blok</h3>
                <p className="text-[11px] mb-3" style={{ color: 'var(--t3)' }}>
                  Seret pada kotak di bawah untuk pilih jumlah baris × kolom
                </p>

                <div className="mb-4">
                  <GridSizePicker
                    rows={parseInt(gridRows) || 1}
                    cols={parseInt(gridCols) || 1}
                    onChange={(r, c) => { setGridRows(String(r)); setGridCols(String(c)) }}
                  />
                </div>

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
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-lg text-sm font-medium flex items-start gap-2 max-w-lg"
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
                <button onClick={deleteSelected}
                  className="w-full py-1.5 rounded text-[11px] font-medium"
                  style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  Hapus Unit
                </button>
              </div>
            )}

            {/* Batch selection summary (more than one unit) */}
            {selectedUnits.length > 1 && (
              <div className="mb-4 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
                <p className="text-[10px] font-semibold tracking-widest uppercase mb-2" style={{ color: 'var(--t3)' }}>
                  {selectedUnits.length} Unit Dipilih
                </p>
                <p className="text-[11px] mb-2" style={{ color: 'var(--t3)' }}>
                  Atur tipe, urgensi, subkon, atau pengawas di bawah untuk semua sekaligus.
                </p>
                <button onClick={deleteSelected}
                  className="w-full py-1.5 rounded text-[11px] font-medium"
                  style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  Hapus {selectedUnits.length} Unit
                </button>
              </div>
            )}

            {selectedUnits.length === 0 && (
              <p className="text-[12px] text-center py-4" style={{ color: 'var(--t3)' }}>
                Pilih unit di kanvas untuk mengkonfigurasi.<br />
                <span className="text-[11px]">Seret di area kosong untuk pilih banyak, Shift+klik untuk menambah.</span>
              </p>
            )}

            {/* Tab: Tipe */}
            {configTab === 'type' && selectedUnits.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {UNIT_TYPES.map(ut => {
                  const active = commonValue(u => u.unit_type) === ut.value
                  return (
                    <button key={ut.value} onClick={() => updateSelected({ unit_type: ut.value })}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] text-left"
                      style={{
                        background: active ? 'var(--accent-sub)' : 'var(--bg-2)',
                        border: active ? '1px solid rgba(124,58,237,0.4)' : '1px solid var(--border)',
                        color: active ? 'var(--accent-2)' : 'var(--t2)',
                      }}>
                      <span>{ut.icon}</span><span>{ut.label}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Tab: Urgensi */}
            {configTab === 'urgency' && selectedUnits.length > 0 && (
              <div className="space-y-2">
                {URGENCY_OPTIONS.map(opt => {
                  const active = commonValue(u => u.urgency ?? 'normal') === opt.value
                  return (
                    <button key={opt.value} onClick={() => updateSelected({ urgency: opt.value as 'normal' | 'high' | 'critical' })}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium"
                      style={{
                        background: active ? 'var(--bg-3)' : 'var(--bg-2)',
                        border: `1px solid ${active ? opt.color : 'var(--border)'}`,
                        color: active ? opt.color : 'var(--t2)',
                      }}>
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: opt.color }} />
                      {opt.label}
                    </button>
                  )
                })}
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
                {subs.length > 0 && (
                  <p className="text-[11px]" style={{ color: selectedUnits.length > 0 ? 'var(--accent-2)' : 'var(--t3)' }}>
                    {selectedUnits.length > 0
                      ? `Klik subkon untuk menugaskan ke ${selectedUnits.length} unit terpilih`
                      : 'Pilih unit dulu (seret untuk pilih banyak), lalu klik subkon'}
                  </p>
                )}
                {subs.map((s, i) => {
                  const assignedCount = units.filter(u => u.subcontractor_color === s.color).length
                  const active = commonValue(u => u.subcontractor_color) === s.color
                  return (
                    <div key={i} className="flex items-center gap-1.5">
                      <button onClick={() => updateSelected({ subcontractor_color: s.color })}
                        className="flex-1 flex items-center gap-3 px-3 py-2 rounded-lg text-[12px]"
                        style={{
                          background: active ? 'var(--bg-3)' : 'var(--bg-2)',
                          border: `1px solid ${active ? s.color : 'var(--border)'}`,
                          color: 'var(--t1)',
                        }}>
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: s.color }} />
                        <span className="flex-1 text-left truncate">{s.name}</span>
                        {assignedCount > 0 && (
                          <span className="text-[10px] font-mono flex-shrink-0" style={{ color: 'var(--t3)' }}>{assignedCount}</span>
                        )}
                      </button>
                      <button onClick={() => renameSub(i)} title="Ganti nama"
                        className="px-2 py-2 rounded-lg text-[12px] flex-shrink-0"
                        style={{ background: 'var(--bg-2)', color: 'var(--t2)', border: '1px solid var(--border)' }}>
                        ✎
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
