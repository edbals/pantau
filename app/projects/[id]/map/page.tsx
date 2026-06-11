'use client'

import { useState, useEffect, useCallback, useMemo, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import MapCanvas, { CanvasUnit, UnitType, GridRect, Tool } from '@/components/map/MapCanvas'
import GridSizePicker from '@/components/map/GridSizePicker'
import StudioStepsHud, { type StudioStep } from '@/components/map/StudioStepsHud'
import NumberRulesTable from '@/components/map/NumberRulesTable'
import FloatingRefMap from '@/components/map/FloatingRefMap'
import ShortcutsHud from '@/components/map/ShortcutsHud'
import ContactDirectoryModal from '@/components/map/ContactDirectoryModal'
import { type ProjectContact, contactPlatform } from '@/components/map/contacts'
import {
  validateUnitCodes,
  generateGridCodes,
  generateCodes,
  parseSkipList,
  type SkipRule,
} from '@/lib/digitize/numbering'
import {
  materializeGrid,
  materializeCanvas,
  captureCellOverrides,
  parseGridCellId,
  type GridBlock,
} from '@/lib/digitize/grid-block'
import {
  Undo2, Redo2, Hand, MousePointer2, Pencil, Grid3x3,
  Magnet, Loader2, Upload, Save as SaveIcon, Rocket, BrainCircuit,
  Eye, AlignStartHorizontal, AlignStartVertical, AlignHorizontalDistributeCenter,
  Home, Route, Trees, MessageCircle, Send, Plus,
} from 'lucide-react'
// SPK templates are managed separately at /spk, not inside the denah editor.
type ConfigTab = 'type' | 'urgency' | 'subcontractor' | 'supervisor' | 'directory'

// Local autosave draft. MUST carry the grid source-of-truth alongside the
// materialized units — restoring units alone desyncs them from `grids` and
// reverts the editor to grid-less flat units ("state amnesia").
interface MapDraft {
  units: CanvasUnit[]
  grids?: GridBlock[]
  globalSkipRules?: SkipRule[]
  skipNumbers?: number[]
  savedAt: string
}

// One undo/redo snapshot: the materialized units and their source grids.
interface HistEntry {
  units: CanvasUnit[]
  grids: GridBlock[]
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
  // Editable grid blocks; their cells live in `units` (materialized output).
  const [grids, setGrids] = useState<GridBlock[]>([])
  const gridsRef = useRef<GridBlock[]>(grids)
  // Project-wide numbering rules inherited by every block with useGlobalRules.
  const [globalSkipRules, setGlobalSkipRules] = useState<SkipRule[]>([])
  const globalRulesRef = useRef<SkipRule[]>(globalSkipRules)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [tool, setTool] = useState<Tool>('select')
  const [snapEnabled, setSnapEnabled] = useState(true)
  // Active draw preset: what type a newly drawn unit gets (Kavling/Jalan/Fasos).
  const [drawPreset, setDrawPreset] = useState<UnitType>('house')
  // Floating "Lihat Denah" reference window (PiP of the original blueprint).
  const [showRefMap, setShowRefMap] = useState(false)
  // "Tanya AI" copilot: highlighted element (pulsed 3s), plus the AI message
  // shown in a tooltip and a loading flag.
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null)
  const highlightTimer = useRef<number | null>(null)
  const [copilotMessage, setCopilotMessage] = useState<string | null>(null)
  const [copilotLoading, setCopilotLoading] = useState(false)
  const copilotTimer = useRef<number | null>(null)
  // Spacebar-to-pan: while Space is held the canvas behaves as the Hand tool,
  // then reverts to whatever tool was active. toolRef keeps the keydown closure
  // current without re-binding the listener on every tool change.
  const toolRef = useRef<Tool>(tool)
  const spacePan = useRef<{ prevTool: Tool } | null>(null)
  // Clipboard for copy/paste of a whole grid block.
  const gridClipboard = useRef<GridBlock | null>(null)
  const [configTab, setConfigTab] = useState<ConfigTab>('type')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [digitizing, setDigitizing] = useState(false)
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [planRotation, setPlanRotation] = useState(0)
  // Rotation already baked into the current bgImageUrl (set at digitize time),
  // so live tilt only previews the DELTA — no double-rotation.
  const [bakedRotation, setBakedRotation] = useState(0)
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
  // Project directory (WhatsApp / Telegram contacts), managed via a modal.
  const [projectContacts, setProjectContacts] = useState<ProjectContact[]>([])
  const [showContactModal, setShowContactModal] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  // Pending recoverable draft (offered via the banner). Holds the FULL draft so
  // recovery restores grids + rules, not just the flat units.
  const [pendingDraft, setPendingDraft] = useState<MapDraft | null>(null)
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

  // The single grid block that owns the current selection (if any) — drives the
  // grid config panel and the on-canvas bbox handles.
  const selectedGridId = useMemo(() => {
    const gids = new Set(
      selectedIds.map(id => parseGridCellId(id)?.gridId).filter((g): g is string => !!g)
    )
    return gids.size === 1 ? [...gids][0] : null
  }, [selectedIds])
  const selectedGrid = grids.find(g => g.id === selectedGridId) ?? null
  const gridBoxes = useMemo(() => Object.fromEntries(grids.map(g => [g.id, g.bbox])), [grids])
  // All grid blocks the current selection touches — alignment needs ≥ 2.
  const selectedGridIds = useMemo(
    () => [...new Set(selectedIds.map(id => parseGridCellId(id)?.gridId).filter((g): g is string => !!g))],
    [selectedIds]
  )

  // Keep refs current so effects/callbacks read the latest without re-binding.
  useEffect(() => { gridsRef.current = grids }, [grids])
  useEffect(() => { globalRulesRef.current = globalSkipRules }, [globalSkipRules])

  // Re-materialize a grid into `units`, preserving per-cell assignments. One
  // helper for every grid edit (rows/cols/numbering/bbox), so they stay in sync.
  const commitGrid = useCallback((next: GridBlock) => {
    setIsDirty(true)
    setGrids(prev => prev.map(g => g.id === next.id ? next : g))
    setUnits(prev => {
      const captured = captureCellOverrides(next, prev)
      const cells = materializeGrid(captured, globalRulesRef.current)
      return [...prev.filter(u => parseGridCellId(u.id)?.gridId !== next.id), ...cells]
    })
  }, [])

  // Edit the project-wide rules and instantly re-materialize every block that
  // inherits them (useGlobalRules !== false).
  const applyGlobalRules = useCallback((rules: SkipRule[]) => {
    setIsDirty(true)
    setGlobalSkipRules(rules)
    globalRulesRef.current = rules
    setUnits(prevUnits => {
      let next = prevUnits
      for (const g of gridsRef.current) {
        if (g.useGlobalRules === false) continue
        const captured = captureCellOverrides(g, next)
        const cells = materializeGrid(captured, rules)
        next = [...next.filter(u => parseGridCellId(u.id)?.gridId !== g.id), ...cells]
      }
      return next
    })
  }, [])

  // Live bbox move/resize from the canvas handles.
  const handleGridResize = useCallback((id: string, bbox: GridBlock['bbox']) => {
    const g = gridsRef.current.find(x => x.id === id)
    if (g) commitGrid({ ...g, bbox })
  }, [commitGrid])

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
        const cd = j.data.canvas_data ?? {}
        const serverGrids: GridBlock[] = Array.isArray(cd.grids) ? cd.grids : []
        const globalRules: SkipRule[] = Array.isArray(cd.globalSkipRules) ? cd.globalSkipRules : []
        setGlobalSkipRules(globalRules)
        if (Array.isArray(cd.skipNumbers)) setSkipNumbers(cd.skipNumbers)
        if (Array.isArray(cd.subs)) setSubs(cd.subs)
        if (Array.isArray(cd.projectContacts)) setProjectContacts(cd.projectContacts)

        // Hydrate from the GridBlock model when present: re-materialize the active
        // units from grids + freeUnits so block selection + the config panel
        // survive a reload. Only fall back to legacy flat units when grids is
        // missing or empty.
        let activeUnits: CanvasUnit[]
        if (serverGrids.length > 0) {
          setGrids(serverGrids)
          const freeUnits: CanvasUnit[] = Array.isArray(cd.freeUnits)
            ? cd.freeUnits
            : (Array.isArray(cd.units) ? cd.units : []).filter((u: CanvasUnit) => !parseGridCellId(u.id))
          activeUnits = materializeCanvas(serverGrids, freeUnits, globalRules)
        } else {
          activeUnits = Array.isArray(cd.units) ? cd.units : []
        }
        setUnits(activeUnits)
        initialUnitsRef.current = activeUnits

        try {
          const raw = localStorage.getItem(`pantau_map_${id}`)
          if (raw) {
            const draft = JSON.parse(raw) as MapDraft
            // A draft from before the GridBlock era has no `grids` key. Restoring
            // it against a project that HAS grids would wipe the block model
            // ("state amnesia") — discard it instead of offering recovery.
            const isStaleFormat = serverGrids.length > 0 && !Array.isArray(draft.grids)
            // Only offer recovery when the draft actually differs from what was
            // just loaded from the server — otherwise it's redundant noise.
            const differs =
              JSON.stringify(draft.units ?? []) !== JSON.stringify(activeUnits) ||
              JSON.stringify(draft.grids ?? []) !== JSON.stringify(serverGrids)
            const dismissed = sessionStorage.getItem(`pantau_map_dismiss_${id}`) === draft.savedAt
            if (isStaleFormat || !differs) {
              localStorage.removeItem(`pantau_map_${id}`)
            } else if (draft.units?.length > 0 && !dismissed) {
              setPendingDraft(draft)
            }
          }
        } catch {}
      })
  }, [id])

  // ── Undo / redo (coalesces rapid changes such as drags into one step) ──
  // Snapshots units AND grids together so grid-structural edits are undoable.
  const undoStack = useRef<HistEntry[]>([])
  const redoStack = useRef<HistEntry[]>([])
  const histBaseline = useRef<HistEntry | null>(null)
  const skipHistory = useRef(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const syncHistFlags = () => {
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(redoStack.current.length > 0)
  }

  useEffect(() => {
    // grids always change alongside units (every grid edit re-materializes), so
    // watching units catches everything; we snapshot grids from the ref.
    const snap = (): HistEntry => ({ units, grids: gridsRef.current })
    if (skipHistory.current) { skipHistory.current = false; histBaseline.current = snap(); return }
    if (histBaseline.current === null) { histBaseline.current = snap(); return }
    if (histBaseline.current.units === units) return
    const t = setTimeout(() => {
      if (histBaseline.current && histBaseline.current.units !== units) {
        undoStack.current.push(histBaseline.current)
        if (undoStack.current.length > 50) undoStack.current.shift()
        redoStack.current = []
        histBaseline.current = snap()
        syncHistFlags()
      }
    }, 450)
    return () => clearTimeout(t)
  }, [units])

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return
    redoStack.current.push({ units, grids: gridsRef.current })
    const prev = undoStack.current.pop()!
    skipHistory.current = true
    histBaseline.current = prev
    setUnits(prev.units)
    setGrids(prev.grids)
    setSelectedIds([])
    setIsDirty(true)
    syncHistFlags()
  }, [units])

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return
    undoStack.current.push({ units, grids: gridsRef.current })
    const next = redoStack.current.pop()!
    skipHistory.current = true
    histBaseline.current = next
    setUnits(next.units)
    setGrids(next.grids)
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

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return
    // Deleting any cell of a grid removes the whole block (and its source grid).
    const sel = new Set(selectedIds)
    const gids = new Set(
      selectedIds.map(id => parseGridCellId(id)?.gridId).filter((g): g is string => !!g)
    )
    setIsDirty(true)
    if (gids.size > 0) setGrids(prev => prev.filter(g => !gids.has(g.id)))
    setUnits(prev => prev.filter(u => {
      if (sel.has(u.id)) return false
      const gid = parseGridCellId(u.id)?.gridId
      return !(gid && gids.has(gid))
    }))
    setSelectedIds([])
  }, [selectedIds])

  // ── Figma-style alignment of the selected grid blocks ──
  const alignSelectedGrids = useCallback((mode: 'top' | 'left' | 'distribute-h') => {
    const ids = new Set(
      selectedIds.map(id => parseGridCellId(id)?.gridId).filter((g): g is string => !!g)
    )
    const blocks = gridsRef.current.filter(g => ids.has(g.id))
    if (blocks.length < 2) return

    const updates = new Map<string, GridBlock['bbox']>()
    if (mode === 'top') {
      const top = Math.min(...blocks.map(b => b.bbox.y))
      for (const b of blocks) updates.set(b.id, { ...b.bbox, y: top })
    } else if (mode === 'left') {
      const left = Math.min(...blocks.map(b => b.bbox.x))
      for (const b of blocks) updates.set(b.id, { ...b.bbox, x: left })
    } else {
      // Distribute horizontally: equal gaps across the collective bounds.
      const sorted = [...blocks].sort((a, b) => a.bbox.x - b.bbox.x)
      const left = sorted[0].bbox.x
      const right = Math.max(...sorted.map(b => b.bbox.x + b.bbox.width))
      const totalW = sorted.reduce((s, b) => s + b.bbox.width, 0)
      const gap = (right - left - totalW) / (sorted.length - 1)
      let cursor = left
      for (const b of sorted) { updates.set(b.id, { ...b.bbox, x: cursor }); cursor += b.bbox.width + gap }
    }

    setIsDirty(true)
    setGrids(prev => prev.map(g => updates.has(g.id) ? { ...g, bbox: updates.get(g.id)! } : g))
    setUnits(prev => {
      let next = prev
      for (const [id, bbox] of updates) {
        const g = gridsRef.current.find(x => x.id === id)
        if (!g) continue
        const captured = captureCellOverrides({ ...g, bbox }, next)
        const cells = materializeGrid(captured, globalRulesRef.current)
        next = [...next.filter(u => parseGridCellId(u.id)?.gridId !== id), ...cells]
      }
      return next
    })
  }, [selectedIds])

  // Keep the keyboard closure's view of the active tool current.
  useEffect(() => { toolRef.current = tool }, [tool])

  const save = useCallback(async () => {
    setSaving(true)
    const res = await fetch(`/api/v1/projects/${id}/map/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canvas_data: {
          // units = materialized output (read by the PM viewer); grids + freeUnits
          // = the editor source of truth, re-hydrated on load.
          units,
          grids,
          freeUnits: units.filter(u => !parseGridCellId(u.id)),
          globalSkipRules, skipNumbers, subs, projectContacts,
        },
      }),
    })
    if (res.ok) {
      setIsDirty(false)
      try { localStorage.removeItem(`pantau_map_${id}`) } catch {}
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [id, units, grids, globalSkipRules, skipNumbers, subs, projectContacts])

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
      // Hold Space to temporarily pan (reverts to the prior tool on release).
      if (e.code === 'Space') {
        e.preventDefault()
        if (!spacePan.current) {
          spacePan.current = { prevTool: toolRef.current }
          setTool('hand')
        }
        return
      }
      // Copy / paste a whole grid block.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        const gids = new Set(selectedIds.map(id => parseGridCellId(id)?.gridId).filter((x): x is string => !!x))
        const gid = gids.size === 1 ? [...gids][0] : null
        const g = gid ? gridsRef.current.find(x => x.id === gid) : null
        if (g) { e.preventDefault(); gridClipboard.current = g }
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        const src = gridClipboard.current
        if (src) {
          e.preventDefault()
          const grid: GridBlock = {
            ...src,
            id: `grid_${Date.now()}`,
            bbox: {
              x: Math.min(0.95, Math.max(0, src.bbox.x + 0.03)),
              y: Math.min(0.95, Math.max(0, src.bbox.y + 0.03)),
              width: src.bbox.width,
              height: src.bbox.height,
            },
            cellOverrides: undefined, // fresh clone of structure, not assignments
          }
          const cells = materializeGrid(grid, globalRulesRef.current)
          setIsDirty(true)
          setGrids(prev => [...prev, grid])
          setUnits(prev => [...prev, ...cells])
          setSelectedIds(cells.map(c => c.id))
        }
        return
      }
      if (e.key === 'v') setTool('select')
      if (e.key === 'h') setTool('hand')
      if (e.key === 'r') setTool('draw')
      if (e.key === 'g') setTool('grid')
      if (e.key === 'Escape') setSelectedIds([])
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        deleteSelected()
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space' && spacePan.current) {
        setTool(spacePan.current.prevTool)
        spacePan.current = null
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [save, selectedIds, undo, redo, deleteSelected])

  // Autosave to localStorage — fires 1.5 s after any user-initiated change
  useEffect(() => {
    if (units === initialUnitsRef.current) return
    if (!isDirty) return
    const timer = setTimeout(() => {
      try {
        const draft: MapDraft = {
          units,
          grids: gridsRef.current,
          globalSkipRules: globalRulesRef.current,
          skipNumbers,
          savedAt: new Date().toISOString(),
        }
        localStorage.setItem(draftKey, JSON.stringify(draft))
      } catch {}
    }, 1500)
    return () => clearTimeout(timer)
  }, [units, isDirty, draftKey, skipNumbers])

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
    setGrids([])

    try {
      const imageForAnalysis = await prepareImageForAnalysis(file, rotation)

      // Show the exact image sent to Gemini so returned coordinates line up.
      setBgImageUrl(URL.createObjectURL(imageForAnalysis))
      setBakedRotation(rotation) // this angle is now baked in; live tilt resets to delta 0

      const fd = new FormData()
      fd.append('image', imageForAnalysis)
      const res = await fetch(`/api/v1/projects/${id}/map/digitize`, { method: 'POST', body: fd })
      const json = await res.json()

      if (!res.ok) {
        setDetectError(json.error?.message ?? `Server error ${res.status}`)
        setDigitizing(false)
        return
      }

      type Box = { x: number; y: number; width: number; height: number }
      const detectedGrids: Array<{
        prefix: string; rows: number; cols: number; start_number: number; bounding_box: Box
      }> = json.data?.detected_grids ?? []
      const nonGridAreas: Array<{
        area_type: UnitType; label: string | null; bounding_box: Box
      }> = json.data?.non_grid_areas ?? []

      const diag = json.data?.diagnostics
      if (diag) {
        setDetectDiag({
          model: diag.model ?? null,
          grids: diag.grids_detected ?? 0,
          areas: diag.non_grid_areas ?? 0,
        })
      }

      // Primary path: instantiate AI-detected blocks as editable GridBlocks so
      // they behave identically to manual grids (clickable, handles, config panel).
      if (detectedGrids.length > 0 || nonGridAreas.length > 0) {
        const stamp = Date.now()
        const newGrids: GridBlock[] = detectedGrids.map((g, i) => ({
          id: `grid_${stamp}_${i}`,
          prefix: g.prefix,
          rows: g.rows,
          cols: g.cols,
          start: g.start_number,
          bbox: g.bounding_box,
          skipRules: [],
          useGlobalRules: true,
          unitType: 'house',
        }))
        const gridUnits = newGrids.flatMap(g => materializeGrid(g, globalRulesRef.current))
        // Roads / common areas are free (non-grid) units kept alongside the grids.
        const areaUnits: CanvasUnit[] = nonGridAreas.map((a, i) => ({
          id: `area_${stamp}_${i}`,
          unit_code: a.label ?? '',
          unit_type: a.area_type ?? 'road',
          x: a.bounding_box.x, y: a.bounding_box.y,
          width: a.bounding_box.width, height: a.bounding_box.height,
          rotation: 0,
        }))
        const all = [...gridUnits, ...areaUnits]
        setIsDirty(true)
        setGrids(newGrids)
        setUnits(all)
        // Select the first block so its handles + config panel show immediately.
        if (newGrids.length > 0) {
          setSelectedIds(gridUnits.filter(u => parseGridCellId(u.id)?.gridId === newGrids[0].id).map(u => u.id))
        }
        setDetectCount(countSellableUnits(all))
      } else {
        // Fallback: flat units (e.g. the stub layout when no API key is set).
        const detected: Array<{
          temp_id: string; suggested_code: string; type: UnitType
          coordinates: Box; label_detected: string | null; rotation_degrees?: number
        }> = json.data?.detected_units ?? []
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

    // Create an editable GridBlock; its cells are materialized into `units`.
    const grid: GridBlock = {
      id: `grid_${Date.now()}`,
      prefix, rows, cols, start,
      bbox: gridRect,
      skipRules: skip.map(target => ({ target, action: 'skip' as const })),
      // Honour modal skips locally; otherwise inherit the project rules.
      useGlobalRules: skip.length === 0,
      unitType: 'house',
    }
    const cells = materializeGrid(grid, globalRulesRef.current)

    // Remember the skips so validation won't flag them as gaps.
    if (skip.length > 0) {
      setSkipNumbers(prev => [...new Set([...prev, ...skip])].sort((a, b) => a - b))
    }
    setIsDirty(true)
    setGrids(prev => [...prev, grid])
    setUnits(prev => [...prev, ...cells])
    setSelectedIds(cells.map(c => c.id)) // select the new block
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

  // ── Project directory CRUD ──
  function addContact(contact: Omit<ProjectContact, 'id'>) {
    setProjectContacts(prev => [...prev, { id: `c_${Date.now()}`, ...contact }])
    setIsDirty(true)
  }
  function deleteContact(cid: string) {
    setProjectContacts(prev => prev.filter(c => c.id !== cid))
    // Unassign from every unit that referenced it.
    setUnits(prev => prev.map(u =>
      u.assigned_contact_ids?.includes(cid)
        ? { ...u, assigned_contact_ids: u.assigned_contact_ids.filter(x => x !== cid) }
        : u
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

  // ── Agentic "Tanya AI" copilot: POST a canvas snapshot, render the reply, run the action ──
  function highlightFor(target: string) {
    if (target === 'tab-urgency') setConfigTab('urgency')
    if (target === 'tab-subcontractor') setConfigTab('subcontractor')
    if (target === 'tool-grid') setTool('grid')
    setActiveHighlight(target)
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = window.setTimeout(() => setActiveHighlight(null), 3000)
  }
  async function askAI(stepKey: string) {
    if (copilotLoading) return
    if (copilotTimer.current) clearTimeout(copilotTimer.current)
    setCopilotLoading(true)
    setCopilotMessage(null)
    const snapshot = {
      activeStep: stepKey,
      hasDenah: !!bgImageUrl,
      unitCount: units.length,
      gridCount: grids.length,
      sellableUnits: countSellableUnits(units),
      assignedUnits: units.filter(u => isSellableUnit(u) && u.assigned_contact_ids?.length).length,
      urgencyUnits: units.filter(u => u.urgency && u.urgency !== 'normal').length,
      contactsCount: projectContacts.length,
    }
    try {
      const res = await fetch(`/api/v1/projects/${id}/map/copilot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot }),
      })
      const json = await res.json()
      const data = json.data as { message?: string; action?: string; targetElement?: string } | undefined
      if (!data?.message) {
        setCopilotMessage('AI sedang tidak tersedia. Coba lagi nanti.')
      } else {
        setCopilotMessage(data.message)
        if ((data.action === 'highlight_ui' || data.action === 'skip_step') && data.targetElement) {
          highlightFor(data.targetElement)
        }
      }
    } catch {
      setCopilotMessage('Koneksi AI gagal — periksa internet.')
    } finally {
      setCopilotLoading(false)
      copilotTimer.current = window.setTimeout(() => setCopilotMessage(null), 9000)
    }
  }
  // Pulsating purple ring shown around the highlighted element.
  const pulseRing = '0 0 0 2px #7C3AED, 0 0 18px rgba(124,58,237,0.7)'

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

        {/* Floating reference window toggle — PiP of the original blueprint */}
        {bgImageUrl && (
          <button onClick={() => setShowRefMap(s => !s)}
            title="Tampilkan denah asli dalam jendela mengambang"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium"
            style={{
              background: showRefMap ? 'var(--accent-sub)' : 'var(--bg-2)',
              border: showRefMap ? '1px solid rgba(124,58,237,0.3)' : '1px solid var(--border)',
              color: showRefMap ? 'var(--accent-2)' : 'var(--t2)',
            }}>
            <Eye size={14} /> Lihat Denah
          </button>
        )}

        {/* Upload site plan */}
        <label id="btn-upload-denah"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer ${activeHighlight === 'btn-upload-denah' ? 'animate-pulse' : ''}`}
          style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)', boxShadow: activeHighlight === 'btn-upload-denah' ? pulseRing : undefined }}>
          {digitizing
            ? <><Loader2 size={14} className="animate-spin" /> Menganalisis...</>
            : <><Upload size={14} /> Upload Denah</>}
          <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.heic,.pdf"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleDigitize(file, planRotation)
              e.currentTarget.value = ''
            }} />
        </label>

        <button onClick={save} disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium"
          style={{
            background: 'var(--bg-3)',
            color: saving ? 'var(--t3)' : saved ? 'var(--green)' : isDirty ? 'var(--amber)' : 'var(--t2)',
            border: `1px solid ${isDirty && !saving && !saved ? 'rgba(245,158,11,0.4)' : 'var(--border-md)'}`,
          }}>
          {saving
            ? <><Loader2 size={13} className="animate-spin" /> Menyimpan...</>
            : saved ? '✓ Tersimpan'
            : isDirty ? '● Belum disimpan'
            : <><SaveIcon size={13} /> Simpan</>}
        </button>

        <button id="btn-golive" onClick={goLive}
          className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-semibold text-white ${activeHighlight === 'btn-golive' ? 'animate-pulse' : ''}`}
          style={{ background: 'var(--green)', boxShadow: activeHighlight === 'btn-golive' ? pulseRing : '0 0 12px rgba(16,185,129,0.3)' }}>
          <Rocket size={14} /> Go Live
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
              <Undo2 size={15} />
            </button>
            <button onClick={redo} disabled={!canRedo} title="Ulangi (⌘⇧Z)"
              className="w-[26px] h-7 flex items-center justify-center rounded-lg text-[14px] transition-all"
              style={{ background: 'transparent', color: canRedo ? 'var(--t2)' : 'var(--t3)', opacity: canRedo ? 1 : 0.35 }}>
              <Redo2 size={15} />
            </button>
          </div>

          <div className="w-8 h-px my-1" style={{ background: 'var(--border)' }} />

          {([
            { t: 'hand'   as Tool, Icon: Hand,          label: 'Geser',  tip: 'Geser peta (H atau tahan Spasi) — atau seret tombol tengah mouse' },
            { t: 'select' as Tool, Icon: MousePointer2, label: 'Pilih',  tip: 'Pilih & seret untuk pilih banyak (V)' },
            { t: 'draw'   as Tool, Icon: Pencil,        label: 'Gambar', tip: 'Gambar unit (R) — pilih preset Kavling/Jalan/Fasos' },
            { t: 'grid'   as Tool, Icon: Grid3x3,       label: 'Grid',   tip: 'Grid blok otomatis (G)' },
          ]).map(({ t, Icon, label, tip }) => (
            <div key={t} className="relative">
              <button onClick={() => setTool(t)} title={tip}
                id={t === 'grid' ? 'tool-grid' : undefined}
                className={`w-14 flex flex-col items-center gap-1 py-1.5 rounded-lg transition-all ${activeHighlight === 'tool-grid' && t === 'grid' ? 'animate-pulse' : ''}`}
                style={{
                  background: tool === t ? 'var(--accent-sub)' : 'transparent',
                  border: tool === t ? '1px solid rgba(124,58,237,0.3)' : '1px solid transparent',
                  color: tool === t ? 'var(--accent-2)' : 'var(--t3)',
                  boxShadow: activeHighlight === 'tool-grid' && t === 'grid' ? pulseRing : undefined,
                }}>
                <Icon size={18} />
                <span className="text-[9px] font-medium leading-none">{label}</span>
              </button>

              {/* Draw presets flyout — what type the next drawn unit gets */}
              {t === 'draw' && tool === 'draw' && (
                <div className="absolute left-full top-0 ml-1.5 z-30 flex flex-col gap-0.5 p-1 rounded-lg"
                  style={{ background: 'var(--bg-1)', border: '1px solid var(--border-md)', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
                  {([
                    { type: 'house'       as UnitType, Icon: Home,  label: 'Kavling' },
                    { type: 'road'        as UnitType, Icon: Route, label: 'Jalan' },
                    { type: 'common_area' as UnitType, Icon: Trees, label: 'Fasos' },
                  ]).map(({ type, Icon: PIcon, label: pLabel }) => (
                    <button key={type} onClick={() => setDrawPreset(type)}
                      title={`Gambar ${pLabel}`}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-medium whitespace-nowrap transition-all"
                      style={{
                        background: drawPreset === type ? 'var(--accent-sub)' : 'transparent',
                        color: drawPreset === type ? 'var(--accent-2)' : 'var(--t2)',
                      }}>
                      <PIcon size={14} />{pLabel}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
            <Magnet size={16} />
            <span className="text-[9px] font-medium leading-none">Snap</span>
          </button>

          {/* Alignment — operates on 2+ selected grid blocks (Figma-style) */}
          {(() => {
            const canAlign = selectedGridIds.length >= 2
            const actions = [
              { mode: 'top' as const, Icon: AlignStartHorizontal, tip: 'Ratakan atas' },
              { mode: 'left' as const, Icon: AlignStartVertical, tip: 'Ratakan kiri' },
              { mode: 'distribute-h' as const, Icon: AlignHorizontalDistributeCenter, tip: 'Distribusi horizontal' },
            ]
            return (
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[8px] font-medium" style={{ color: 'var(--t3)' }}>Ratakan</span>
                <div className="flex gap-0.5">
                  {actions.map(({ mode, Icon, tip }) => (
                    <button key={mode} onClick={() => alignSelectedGrids(mode)} disabled={!canAlign} title={tip}
                      className="w-[26px] h-7 flex items-center justify-center rounded-lg transition-all"
                      style={{ background: 'transparent', color: canAlign ? 'var(--accent-2)' : 'var(--t3)', opacity: canAlign ? 1 : 0.3 }}>
                      <Icon size={15} />
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}

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
              { key: 'kavling', label: 'Kavling', done: units.length > 0, detail: sellable > 0 ? String(sellable) : undefined, onClick: () => setTool('grid') },
              { key: 'urgensi', label: 'Urgensi', done: units.some(u => u.urgency && u.urgency !== 'normal'), onClick: () => setConfigTab('urgency') },
              { key: 'tim', label: 'Tim', done: sellable > 0 && assignedSubkon === sellable, detail: sellable > 0 ? `${assignedSubkon}/${sellable}` : undefined, onClick: () => setConfigTab('subcontractor') },
              { key: 'golive', label: 'Go Live', done: false, onClick: goLive },
            ]
            return <StudioStepsHud steps={steps} onAskAI={askAI} copilotMessage={copilotMessage} copilotLoading={copilotLoading} />
          })()}

          {/* Draft recovery banner — restores the FULL draft (units + grids + rules) */}
          {pendingDraft && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium"
              style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.5)', color: 'var(--amber)', backdropFilter: 'blur(8px)', whiteSpace: 'nowrap' }}>
              <span>💾 Ditemukan draft yang belum disimpan ({new Date(pendingDraft.savedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })})</span>
              <button onClick={() => {
                  setIsDirty(true)
                  setUnits(pendingDraft.units)
                  setGrids(pendingDraft.grids ?? [])
                  if (pendingDraft.globalSkipRules) setGlobalSkipRules(pendingDraft.globalSkipRules)
                  if (pendingDraft.skipNumbers) setSkipNumbers(pendingDraft.skipNumbers)
                  setPendingDraft(null)
                }}
                className="px-3 py-1 rounded-lg text-xs font-semibold"
                style={{ background: 'rgba(245,158,11,0.3)', color: 'var(--amber)' }}>
                Pulihkan
              </button>
              <button onClick={() => {
                  try {
                    sessionStorage.setItem(`pantau_map_dismiss_${id}`, pendingDraft.savedAt)
                    localStorage.removeItem(draftKey)
                  } catch {}
                  setPendingDraft(null)
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
            drawUnitType={drawPreset}
            bgTilt={planRotation - bakedRotation}
            gridBoxes={gridBoxes}
            selectedGridId={selectedGridId}
            onGridResize={handleGridResize}
            onGridRect={rect => { setGridRect(rect); setGridPrefix('A'); setGridRows('2'); setGridCols('10') }}
          />

          {/* Floating reference window — original blueprint PiP */}
          {showRefMap && bgImageUrl && (
            <FloatingRefMap imageUrl={bgImageUrl} onClose={() => setShowRefMap(false)} />
          )}

          {/* Team contact management modal */}
          {showContactModal && (
            <ContactDirectoryModal
              contacts={projectContacts}
              onAdd={addContact}
              onDelete={deleteContact}
              onClose={() => setShowContactModal(false)}
            />
          )}

          {/* Shortcuts HUD — input cheatsheet */}
          {!gridRect && tool === 'select' && <ShortcutsHud />}

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

          {/* AI analysis overlay — enterprise loading state */}
          {digitizing && (
            <div className="absolute inset-0 flex items-center justify-center"
              style={{ background: 'rgba(8,12,22,0.82)', backdropFilter: 'blur(3px)' }}>
              <style>{`@keyframes pantauSweep { 0% { transform: translateX(-120%) } 100% { transform: translateX(320%) } }`}</style>
              <div className="flex flex-col items-center">
                <div className="relative flex items-center justify-center mb-5"
                  style={{ width: 64, height: 64 }}>
                  <div className="absolute inset-0 rounded-full animate-ping"
                    style={{ background: 'radial-gradient(circle, rgba(95,208,240,0.35), transparent 70%)' }} />
                  <BrainCircuit size={40} strokeWidth={1.5}
                    style={{ color: '#5FD0F0', filter: 'drop-shadow(0 0 14px rgba(95,208,240,0.7))' }} />
                </div>
                <p className="text-[13px] font-medium tracking-wide" style={{ color: 'var(--t1)' }}>
                  Menganalisis denah…
                </p>
                <p className="text-[11px] mt-1 mb-4" style={{ color: 'var(--t3)' }}>
                  AI mengenali blok & nomor unit · biasanya 5–15 detik
                </p>
                <div className="h-1 rounded-full overflow-hidden" style={{ width: 220, background: 'rgba(95,208,240,0.12)' }}>
                  <div className="h-full rounded-full"
                    style={{
                      width: '35%',
                      background: 'linear-gradient(90deg, transparent, #5FD0F0, transparent)',
                      animation: 'pantauSweep 1.15s ease-in-out infinite',
                    }} />
                </div>
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
              { key: 'type', label: 'Penomoran & Tipe' },
              { key: 'urgency', label: 'Urgensi' },
              { key: 'subcontractor', label: 'Subkon' },
              { key: 'directory', label: 'Direktori' },
            ] as { key: ConfigTab; label: string }[]).map(tab => {
              const hlId = tab.key === 'urgency' ? 'tab-urgency' : tab.key === 'subcontractor' ? 'tab-subcontractor' : undefined
              const pulsing = !!hlId && activeHighlight === hlId
              return (
                <button key={tab.key} id={hlId} onClick={() => setConfigTab(tab.key)}
                  className={`flex-1 py-2.5 text-[11px] font-medium whitespace-nowrap transition-colors ${pulsing ? 'animate-pulse' : ''}`}
                  style={{
                    color: configTab === tab.key ? 'var(--accent-2)' : 'var(--t3)',
                    borderBottom: configTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                    boxShadow: pulsing ? pulseRing : undefined,
                  }}>
                  {tab.label}
                </button>
              )
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-4">

            {/* Grid block config — live rows/cols + custom numbering rules */}
            {selectedGrid && (() => {
              const g = selectedGrid
              const updateGrid = (patch: Partial<GridBlock>) => commitGrid({ ...g, ...patch })
              const rules = g.skipRules ?? []
              const setRules = (next: SkipRule[]) => updateGrid({ skipRules: next })
              const usesGlobal = g.useGlobalRules !== false
              const effectiveRules = usesGlobal ? globalSkipRules : rules
              const total = Math.max(0, g.rows * g.cols)
              const preview = total > 0
                ? generateCodes({ prefix: g.prefix, start: g.start, count: total, rules: effectiveRules })
                : []
              return (
                <div className="mb-4 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--accent-2)' }}>
                      Blok Grid
                    </p>
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--bg-3)', color: 'var(--t2)' }}>{g.prefix || '—'}</span>
                  </div>

                  {/* Rows / Cols */}
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="block text-[10px] mb-1" style={{ color: 'var(--t3)' }}>Baris</label>
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateGrid({ rows: Math.max(1, g.rows - 1) })}
                          className="px-2 py-1 rounded text-sm font-bold" style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>−</button>
                        <input type="number" min={1} value={g.rows}
                          onChange={e => updateGrid({ rows: Math.max(1, parseInt(e.target.value) || 1) })}
                          className="flex-1 w-full px-1 py-1 rounded text-[12px] text-center font-mono outline-none"
                          style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
                        <button onClick={() => updateGrid({ rows: g.rows + 1 })}
                          className="px-2 py-1 rounded text-sm font-bold" style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>+</button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] mb-1" style={{ color: 'var(--t3)' }}>Kolom</label>
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateGrid({ cols: Math.max(1, g.cols - 1) })}
                          className="px-2 py-1 rounded text-sm font-bold" style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>−</button>
                        <input type="number" min={1} value={g.cols}
                          onChange={e => updateGrid({ cols: Math.max(1, parseInt(e.target.value) || 1) })}
                          className="flex-1 w-full px-1 py-1 rounded text-[12px] text-center font-mono outline-none"
                          style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
                        <button onClick={() => updateGrid({ cols: g.cols + 1 })}
                          className="px-2 py-1 rounded text-sm font-bold" style={{ background: 'var(--bg-3)', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>+</button>
                      </div>
                    </div>
                  </div>

                  {/* Prefix / Start */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div>
                      <label className="block text-[10px] mb-1" style={{ color: 'var(--t3)' }}>Prefiks</label>
                      <input value={g.prefix} maxLength={5}
                        onChange={e => updateGrid({ prefix: e.target.value.toUpperCase() })}
                        className="w-full px-2 py-1 rounded text-[12px] text-center font-mono outline-none"
                        style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
                    </div>
                    <div>
                      <label className="block text-[10px] mb-1" style={{ color: 'var(--t3)' }}>Mulai</label>
                      <input type="number" min={1} value={g.start}
                        onChange={e => updateGrid({ start: Math.max(1, parseInt(e.target.value) || 1) })}
                        className="w-full px-2 py-1 rounded text-[12px] text-center font-mono outline-none"
                        style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
                    </div>
                  </div>

                  {/* Numbering: inherit project rules, or define block-local ones */}
                  <div className="mb-1">
                    <label className="flex items-center gap-2 mb-2 cursor-pointer select-none">
                      <input type="checkbox" checked={usesGlobal}
                        onChange={e => updateGrid({ useGlobalRules: e.target.checked })}
                        style={{ accentColor: 'var(--accent)' }} />
                      <span className="text-[11px] font-medium" style={{ color: usesGlobal ? 'var(--accent-2)' : 'var(--t2)' }}>
                        Gunakan Aturan Proyek
                      </span>
                    </label>
                    {usesGlobal ? (
                      <>
                        <p className="text-[10px] mb-1.5" style={{ color: 'var(--t3)' }}>Mewarisi aturan proyek:</p>
                        <NumberRulesTable rules={globalSkipRules} readOnly />
                      </>
                    ) : (
                      <NumberRulesTable rules={rules} onChange={setRules} defaultTarget={g.start} />
                    )}
                  </div>

                  {preview.length > 0 && (
                    <p className="text-[10px] text-center mt-2" style={{ color: 'var(--accent-2)' }}>
                      → {preview.length} unit: {preview[0]} … {preview[preview.length - 1]}
                    </p>
                  )}
                </div>
              )
            })()}

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

                {/* Assign one or more directory contacts (multi-assign) */}
                <div className="mb-2">
                  <label className="block text-[10px] mb-1" style={{ color: 'var(--t3)' }}>Tim / Kontak</label>
                  {projectContacts.length === 0 ? (
                    <button onClick={() => { setConfigTab('directory'); setShowContactModal(true) }}
                      className="w-full py-1.5 rounded text-[11px] font-medium"
                      style={{ background: 'var(--bg-2)', color: 'var(--accent-2)', border: '1px solid var(--border-md)' }}>
                      + Tambah kontak di Direktori
                    </button>
                  ) : (
                    <div className="space-y-1">
                      {projectContacts.map(c => {
                        const assignedIds = selected.assigned_contact_ids ?? []
                        const isAssigned = assignedIds.includes(c.id)
                        const platform = contactPlatform(c.contactUrl)
                        return (
                          <div key={c.id} className="flex items-center gap-1.5">
                            <button
                              onClick={() => updateSelected({
                                assigned_contact_ids: isAssigned
                                  ? assignedIds.filter(x => x !== c.id)
                                  : [...assignedIds, c.id],
                              })}
                              className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-[11px] text-left"
                              style={{
                                background: isAssigned ? 'var(--accent-sub)' : 'var(--bg-2)',
                                border: `1px solid ${isAssigned ? 'rgba(124,58,237,0.4)' : 'var(--border)'}`,
                                color: isAssigned ? 'var(--accent-2)' : 'var(--t2)',
                              }}>
                              <span className="w-3 h-3 rounded-sm flex items-center justify-center flex-shrink-0 text-[8px]"
                                style={{ background: isAssigned ? 'var(--accent)' : 'transparent', border: `1px solid ${isAssigned ? 'var(--accent)' : 'var(--border-md)'}`, color: '#fff' }}>
                                {isAssigned ? '✓' : ''}
                              </span>
                              <span className="flex-1 truncate">{c.name}</span>
                              <span className="text-[9px] opacity-70 flex-shrink-0">{c.role}</span>
                            </button>
                            {platform && (
                              <a href={c.contactUrl} target="_blank" rel="noopener noreferrer"
                                title={platform === 'whatsapp' ? 'Chat WhatsApp' : 'Chat Telegram'} className="flex-shrink-0">
                                {platform === 'whatsapp'
                                  ? <MessageCircle size={15} style={{ color: '#25D366' }} />
                                  : <Send size={14} style={{ color: '#229ED9' }} />}
                              </a>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
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

            {/* Project settings — only on the first tab, only with nothing selected */}
            {selectedIds.length === 0 && configTab === 'type' && (
              <div>
                <p className="text-[10px] font-semibold tracking-widest uppercase mb-2" style={{ color: 'var(--accent-2)' }}>
                  Pengaturan Proyek
                </p>
                <NumberRulesTable rules={globalSkipRules} onChange={applyGlobalRules} />
              </div>
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

            {/* Tab: Pengawas (legacy placeholder; contacts now live in Direktori) */}
            {configTab === 'supervisor' && (
              <div>
                <p className="text-[11px]" style={{ color: 'var(--t3)' }}>
                  Penugasan pengawas tersedia setelah proyek Go Live.
                </p>
              </div>
            )}

            {/* Tab: Direktori Proyek — list + a button into the management modal */}
            {configTab === 'directory' && (
              <div className="space-y-2">
                <button onClick={() => setShowContactModal(true)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-semibold text-white"
                  style={{ background: 'var(--accent)' }}>
                  <Plus size={14} /> Kelola Kontak Tim
                </button>
                {projectContacts.length === 0 ? (
                  <p className="text-[11px] text-center pt-2" style={{ color: 'var(--t3)' }}>Belum ada kontak.</p>
                ) : projectContacts.map(c => {
                  const platform = contactPlatform(c.contactUrl)
                  return (
                    <div key={c.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
                      style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] truncate" style={{ color: 'var(--t1)' }}>{c.name}</div>
                        <div className="text-[10px]" style={{ color: 'var(--t3)' }}>{c.role}</div>
                      </div>
                      {platform && (
                        <a href={c.contactUrl} target="_blank" rel="noopener noreferrer"
                          title={platform === 'whatsapp' ? 'Chat WhatsApp' : 'Chat Telegram'} className="flex-shrink-0">
                          {platform === 'whatsapp'
                            ? <MessageCircle size={16} style={{ color: '#25D366' }} />
                            : <Send size={15} style={{ color: '#229ED9' }} />}
                        </a>
                      )}
                    </div>
                  )
                })}
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
