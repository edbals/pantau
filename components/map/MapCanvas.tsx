'use client'

import { useRef, useState, useEffect, useMemo } from 'react'

export type UnitType =
  | 'house' | 'apartment' | 'shophouse' | 'commercial' | 'villa'
  | 'road' | 'common_area' | 'parking' | 'facility' | 'drainage' | 'boundary'

export interface CanvasUnit {
  id: string
  unit_code: string
  unit_type: UnitType
  x: number; y: number; width: number; height: number  // 0-1 normalised
  rotation?: number  // degrees, clockwise, around unit center
  subcontractor_color?: string
  urgency?: 'normal' | 'high' | 'critical'
  progress_pct?: number
  status?: 'not_started' | 'in_progress' | 'pending_review' | 'completed'
  label?: string
}

export type Tool = 'select' | 'draw' | 'delete' | 'grid' | 'paint' | 'hand'

export interface GridRect { x: number; y: number; width: number; height: number }

interface Props {
  units: CanvasUnit[]
  onChange: (units: CanvasUnit[]) => void
  // Single-select pair (read-only viewer). The editor uses the multi-select
  // pair below, which takes precedence when provided.
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  selectedIds?: string[]
  onSelectionChange?: (ids: string[]) => void
  tool: Tool
  snap?: boolean  // snap drag/resize/draw to the dot grid (default true)
  onPaintUnit?: (id: string) => void  // paint tool: apply the active brush to a unit
  bgImageUrl?: string
  readOnly?: boolean
  showProgress?: boolean
  onGridRect?: (rect: GridRect) => void  // fired when grid tool finishes drawing
}

// Blueprint / CAD palette — thin cool-toned hairlines on navy, light fills.
const BLUEPRINT_BG = '#0A1628'
const TYPE_STYLE: Record<UnitType, { stroke: string; fill: string; dash?: string }> = {
  house:       { stroke: '#5FD0F0', fill: 'rgba(95,208,240,0.05)' },
  apartment:   { stroke: '#5FD0F0', fill: 'rgba(95,208,240,0.05)' },
  villa:       { stroke: '#5FD0F0', fill: 'rgba(95,208,240,0.05)' },
  shophouse:   { stroke: '#F2C572', fill: 'rgba(242,197,114,0.05)' },
  commercial:  { stroke: '#F2C572', fill: 'rgba(242,197,114,0.05)' },
  road:        { stroke: 'rgba(150,185,225,0.55)', fill: 'rgba(150,185,225,0.06)', dash: '5,3' },
  common_area: { stroke: '#6FE7C0', fill: 'rgba(111,231,192,0.06)', dash: '5,3' },
  parking:     { stroke: 'rgba(150,185,225,0.45)', fill: 'rgba(150,185,225,0.05)', dash: '5,3' },
  facility:    { stroke: 'rgba(150,185,225,0.45)', fill: 'rgba(150,185,225,0.05)', dash: '5,3' },
  drainage:    { stroke: 'rgba(150,185,225,0.45)', fill: 'rgba(150,185,225,0.05)', dash: '5,3' },
  boundary:    { stroke: 'rgba(150,185,225,0.5)', fill: 'transparent', dash: '7,4' },
}

const GRID_PX = 22  // dot-grid spacing & snap step (screen px)

function progressColor(pct: number) {
  if (pct === 0) return 'transparent'
  if (pct < 25) return 'rgba(156,163,175,0.3)'
  if (pct < 50) return 'rgba(45,212,191,0.25)'
  if (pct < 75) return 'rgba(20,184,166,0.35)'
  if (pct < 100) return 'rgba(13,148,136,0.45)'
  return 'rgba(16,185,129,0.6)'
}

let uidCounter = 1
function uid() { return `u_${Date.now()}_${uidCounter++}` }

// Smallest a unit may be shrunk to (normalised 0-1), so it never collapses.
const MIN_UNIT_SIZE = 0.008

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

function containFrame(containerW: number, containerH: number, imageW: number, imageH: number) {
  if (containerW <= 0 || containerH <= 0 || imageW <= 0 || imageH <= 0) {
    return { x: 0, y: 0, w: containerW, h: containerH }
  }

  const scale = Math.min(containerW / imageW, containerH / imageH)
  const w = imageW * scale
  const h = imageH * scale
  return { x: (containerW - w) / 2, y: (containerH - h) / 2, w, h }
}

function clampToFrame(x: number, y: number, frame: { x: number; y: number; w: number; h: number }) {
  return {
    x: Math.max(frame.x, Math.min(frame.x + frame.w, x)),
    y: Math.max(frame.y, Math.min(frame.y + frame.h, y)),
  }
}

export default function MapCanvas({
  units, onChange, selectedId, onSelect, selectedIds, onSelectionChange,
  tool, snap = true, onPaintUnit, bgImageUrl, readOnly = false, showProgress = false, onGridRect,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [svgSize, setSvgSize] = useState({ w: 800, h: 600 })
  const [imageSize, setImageSize] = useState<{ src: string; w: number; h: number } | null>(null)
  const drawing = useRef<{ startX: number; startY: number } | null>(null)
  const dragging = useRef<{
    ids: string[]; origins: Record<string, { x: number; y: number }>; sx: number; sy: number
  } | null>(null)
  const resizing = useRef<{
    id: string; handle: ResizeHandle
    ox: number; oy: number; ow: number; oh: number; sx: number; sy: number
  } | null>(null)
  // True while the paint brush is held down (drag to paint many units).
  const painting = useRef(false)
  // Marquee (rubber-band) rectangle in screen px while drag-selecting.
  const marquee = useRef<{ startX: number; startY: number; additive: boolean } | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  // Zoom / pan view transform.
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const panning = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const [isPanning, setIsPanning] = useState(false)

  // Effective selection: multi-select prop wins; otherwise the single id.
  const selection = selectedIds ?? (selectedId ? [selectedId] : [])
  const selectionSet = useMemo(() => new Set(selection), [selection.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const emitSelection = (ids: string[]) => {
    if (onSelectionChange) onSelectionChange(ids)
    else onSelect?.(ids[ids.length - 1] ?? null)
  }
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  // Contain-fit rectangle before any zoom/pan.
  const baseFrame = useMemo(
    () => imageSize && imageSize.src === bgImageUrl
      ? containFrame(svgSize.w, svgSize.h, imageSize.w, imageSize.h)
      : { x: 0, y: 0, w: svgSize.w, h: svgSize.h },
    [imageSize, bgImageUrl, svgSize]
  )

  // View frame = base scaled by zoom and shifted by pan. ALL rendering and
  // pointer math go through this, so zoom/pan apply uniformly.
  const frame = useMemo(
    () => ({ x: baseFrame.x * zoom + pan.x, y: baseFrame.y * zoom + pan.y, w: baseFrame.w * zoom, h: baseFrame.h * zoom }),
    [baseFrame, zoom, pan]
  )

  // Always-current view, so the (passive-safe) wheel listener avoids stale state.
  const viewRef = useRef({ zoom, pan })
  viewRef.current = { zoom, pan }

  const ZOOM_MIN = 0.3
  const ZOOM_MAX = 6
  const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))

  // Zoom toward a screen point (sx,sy), keeping that point stationary.
  function zoomToPoint(nextZoom: number, sx: number, sy: number) {
    const { zoom: z0, pan: p0 } = viewRef.current
    const z = clampZoom(nextZoom)
    const px = (sx - p0.x) / z0
    const py = (sy - p0.y) / z0
    setZoom(z)
    setPan({ x: sx - px * z, y: sy - py * z })
  }
  const zoomBy = (factor: number) => zoomToPoint(viewRef.current.zoom * factor, svgSize.w / 2, svgSize.h / 2)
  const fitView = () => { setZoom(1); setPan({ x: 0, y: 0 }) }

  // Wheel zoom (attached non-passive so we can prevent page scroll).
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = svg!.getBoundingClientRect()
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      zoomToPoint(viewRef.current.zoom * factor, e.clientX - rect.left, e.clientY - rect.top)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset the view when a new background (re-digitize) loads.
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [bgImageUrl])

  // Measure the container, not the SVG (avoids chicken-and-egg sizing)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) setSvgSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!bgImageUrl) return

    const image = new Image()
    image.onload = () => setImageSize({ src: bgImageUrl, w: image.naturalWidth, h: image.naturalHeight })
    image.src = bgImageUrl
  }, [bgImageUrl])

  // Attach mouse events to the WINDOW so drawing isn't cancelled when
  // the cursor briefly leaves the SVG mid-stroke
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drawing.current && !dragging.current && !resizing.current && !marquee.current && !panning.current) return
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      if (panning.current) {
        const { sx, sy, ox, oy } = panning.current
        setPan({ x: ox + (x - sx), y: oy + (y - sy) })
        return
      }

      if (marquee.current) {
        const { startX, startY } = marquee.current
        setMarqueeRect({
          x: Math.min(startX, x), y: Math.min(startY, y),
          w: Math.abs(x - startX), h: Math.abs(y - startY),
        })
        return
      }

      // Snap a screen-pixel delta to the grid (off when snap disabled or Alt held).
      const snapPx = (v: number) => (!snap || e.altKey) ? v : Math.round(v / GRID_PX) * GRID_PX

      if (resizing.current) {
        const { id, handle, ox, oy, ow, oh, sx, sy } = resizing.current
        const dx = snapPx(x - sx) / frame.w
        const dy = snapPx(y - sy) / frame.h
        let nx = ox, ny = oy, nw = ow, nh = oh

        if (handle.includes('e')) nw = ow + dx
        if (handle.includes('s')) nh = oh + dy
        if (handle.includes('w')) { nx = ox + dx; nw = ow - dx }
        if (handle.includes('n')) { ny = oy + dy; nh = oh - dy }

        // Enforce a minimum size without flipping the box past its anchor edge.
        if (nw < MIN_UNIT_SIZE) { if (handle.includes('w')) nx = ox + ow - MIN_UNIT_SIZE; nw = MIN_UNIT_SIZE }
        if (nh < MIN_UNIT_SIZE) { if (handle.includes('n')) ny = oy + oh - MIN_UNIT_SIZE; nh = MIN_UNIT_SIZE }

        // Keep the unit inside the canvas.
        nx = Math.max(0, Math.min(1 - nw, nx))
        ny = Math.max(0, Math.min(1 - nh, ny))
        nw = Math.min(nw, 1 - nx)
        nh = Math.min(nh, 1 - ny)

        onChange(units.map(u => u.id === id ? { ...u, x: nx, y: ny, width: nw, height: nh } : u))
        return
      }

      if (drawing.current) {
        const point = clampToFrame(x, y, frame)
        const { startX, startY } = drawing.current
        setDraft({
          x: Math.min(startX, point.x), y: Math.min(startY, point.y),
          w: Math.abs(point.x - startX), h: Math.abs(point.y - startY),
        })
      }
      if (dragging.current) {
        const { ids, origins, sx, sy } = dragging.current
        // Snap the movement delta so a group keeps its internal spacing.
        const dx = snapPx(x - sx) / frame.w
        const dy = snapPx(y - sy) / frame.h
        const idSet = new Set(ids)
        onChange(units.map(u => {
          if (!idSet.has(u.id)) return u
          const o = origins[u.id]
          return { ...u, x: Math.max(0, Math.min(1 - u.width, o.x + dx)), y: Math.max(0, Math.min(1 - u.height, o.y + dy)) }
        }))
      }
    }

    function onUp(e: MouseEvent) {
      if (drawing.current) {
        const svg = svgRef.current
        if (svg) {
          const rect = svg.getBoundingClientRect()
          const rawX = e.clientX - rect.left
          const rawY = e.clientY - rect.top
          const clamped = clampToFrame(rawX, rawY, frame)
          // Snap both corners to the dot grid for clean, aligned blocks
          // (off when snap disabled or Alt held).
          const snapAxis = (v: number, origin: number) =>
            (!snap || e.altKey) ? v : origin + Math.round((v - origin) / GRID_PX) * GRID_PX
          const x = snapAxis(clamped.x, frame.x)
          const y = snapAxis(clamped.y, frame.y)
          const startX = snapAxis(drawing.current.startX, frame.x)
          const startY = snapAxis(drawing.current.startY, frame.y)
          const nw = Math.abs(x - startX) / frame.w
          const nh = Math.abs(y - startY) / frame.h
          if (nw > 0.015 && nh > 0.015) {
            const nx = (Math.min(startX, x) - frame.x) / frame.w
            const ny = (Math.min(startY, y) - frame.y) / frame.h
            if (tool === 'grid' && onGridRect) {
              // Hand off to parent — parent shows grid config panel
              onGridRect({ x: nx, y: ny, width: nw, height: nh })
            } else {
              const newUnit: CanvasUnit = {
                id: uid(),
                unit_code: `U-${String(units.length + 1).padStart(2, '0')}`,
                unit_type: 'house', x: nx, y: ny, width: nw, height: nh, rotation: 0,
              }
              onChange([...units, newUnit])
              emitSelection([newUnit.id])
            }
          }
        }
        drawing.current = null
        setDraft(null)
      }

      if (marquee.current) {
        const { startX, startY, additive } = marquee.current
        const svg = svgRef.current
        if (svg) {
          const r = svg.getBoundingClientRect()
          const ex = e.clientX - r.left
          const ey = e.clientY - r.top
          const moved = Math.abs(ex - startX) > 3 || Math.abs(ey - startY) > 3
          if (moved) {
            // Normalised marquee rect.
            const mx = (Math.min(startX, ex) - frame.x) / frame.w
            const my = (Math.min(startY, ey) - frame.y) / frame.h
            const mw = Math.abs(ex - startX) / frame.w
            const mh = Math.abs(ey - startY) / frame.h
            const hits = units
              .filter(u => u.x < mx + mw && u.x + u.width > mx && u.y < my + mh && u.y + u.height > my)
              .map(u => u.id)
            emitSelection(additive ? [...new Set([...selection, ...hits])] : hits)
          } else if (!additive) {
            // A plain click on empty canvas clears the selection.
            emitSelection([])
          }
        }
        marquee.current = null
        setMarqueeRect(null)
      }

      dragging.current = null
      resizing.current = null
      painting.current = false
      if (panning.current) { panning.current = null; setIsPanning(false) }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [units, onChange, onSelect, onSelectionChange, selection, svgSize, frame, tool, snap, onGridRect]) // eslint-disable-line react-hooks/exhaustive-deps

  function svgCoords(e: React.MouseEvent) {
    const svg = svgRef.current!
    const rect = svg.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // Middle-mouse, or left-drag while the Hand tool is active, starts a pan from
  // anywhere. Returns true if it consumed the event.
  function maybeStartPan(e: React.MouseEvent): boolean {
    const isMiddle = e.button === 1
    const isHandDrag = tool === 'hand' && e.button === 0
    if (!isMiddle && !isHandDrag) return false
    e.preventDefault()
    const { x, y } = svgCoords(e)
    panning.current = { sx: x, sy: y, ox: pan.x, oy: pan.y }
    setIsPanning(true)
    return true
  }

  function handleSvgMouseDown(e: React.MouseEvent) {
    if (readOnly) return
    if (maybeStartPan(e)) return
    if (e.button !== 0) return
    e.preventDefault()
    const { x, y } = svgCoords(e)
    if (tool === 'draw' || tool === 'grid') {
      const start = clampToFrame(x, y, frame)
      drawing.current = { startX: start.x, startY: start.y }
      setDraft({ x: start.x, y: start.y, w: 0, h: 0 })
      emitSelection([])
    } else if (tool === 'select') {
      // Begin a rubber-band selection from empty canvas.
      marquee.current = { startX: x, startY: y, additive: e.shiftKey || e.metaKey }
    }
  }

  function handleUnitMouseDown(e: React.MouseEvent, id: string) {
    if (readOnly) return
    if (maybeStartPan(e)) return
    e.stopPropagation()
    if (e.button !== 0) return

    if (tool === 'delete') {
      onChange(units.filter(u => u.id !== id))
      emitSelection(selection.filter(s => s !== id))
      return
    }
    if (tool === 'paint') {
      painting.current = true
      onPaintUnit?.(id)
      return
    }
    if (tool === 'select') {
      const additive = e.shiftKey || e.metaKey
      let nextSelection: string[]
      if (additive) {
        // Toggle this unit in/out of the selection.
        nextSelection = selectionSet.has(id) ? selection.filter(s => s !== id) : [...selection, id]
        emitSelection(nextSelection)
        return // don't start a drag while shift-picking
      }
      // Plain click: keep the group if this unit is already part of it (so you
      // can drag the whole group), otherwise select just this one.
      nextSelection = selectionSet.has(id) ? selection : [id]
      emitSelection(nextSelection)

      const { x, y } = svgCoords(e)
      const origins: Record<string, { x: number; y: number }> = {}
      for (const u of units) if (nextSelection.includes(u.id)) origins[u.id] = { x: u.x, y: u.y }
      dragging.current = { ids: nextSelection, origins, sx: x, sy: y }
    }
  }

  function handleResizeStart(e: React.MouseEvent, id: string, handle: ResizeHandle) {
    if (readOnly || e.button !== 0) return
    e.stopPropagation()
    const u = units.find(uu => uu.id === id)
    if (!u) return
    const { x, y } = svgCoords(e)
    resizing.current = { id, handle, ox: u.x, oy: u.y, ow: u.width, oh: u.height, sx: x, sy: y }
  }

  return (
    <div ref={containerRef} className="w-full h-full relative"
      style={{ minHeight: 0 }}>
      <svg
        ref={svgRef}
        width={svgSize.w}
        height={svgSize.h}
        style={{
          display: 'block',
          cursor: isPanning ? 'grabbing'
            : tool === 'hand' ? 'grab'
            : (tool === 'draw' || tool === 'grid') ? 'crosshair'
            : tool === 'delete' ? 'not-allowed'
            : tool === 'paint' ? 'crosshair'
            : 'default',
          background: BLUEPRINT_BG,
          backgroundImage: `radial-gradient(rgba(130,175,235,0.16) 1px, transparent 1.4px)`,
          // Dot grid pans + scales with the content so it feels attached.
          backgroundSize: `${GRID_PX * zoom}px ${GRID_PX * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
          userSelect: 'none',
        }}
        onMouseDown={handleSvgMouseDown}
      >
        {/* Background image — pointer-events:none so it never blocks drawing */}
        {bgImageUrl && (
          <image
            href={bgImageUrl}
            x={frame.x} y={frame.y}
            width={frame.w} height={frame.h}
            opacity={0.45}
            preserveAspectRatio="xMidYMid meet"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Units */}
        {units.map(u => {
          const px = frame.x + u.x * frame.w
          const py = frame.y + u.y * frame.h
          const pw = u.width * frame.w
          const ph = u.height * frame.h
          const rotation = u.rotation ?? 0
          const cx = px + pw / 2
          const cy = py + ph / 2
          const style = TYPE_STYLE[u.unit_type] ?? TYPE_STYLE.house
          const isSelected = selectionSet.has(u.id)
          // Fill: progress color in PM view, otherwise plain type fill (subcon shown as bottom line, not fill)
          const fillColor = showProgress && u.progress_pct !== undefined
            ? progressColor(u.progress_pct)
            : style.fill

          return (
            <g key={u.id}
              transform={rotation ? `rotate(${rotation} ${cx} ${cy})` : undefined}
              style={{ cursor: readOnly ? 'pointer' : isPanning ? 'grabbing' : tool === 'hand' ? 'grab' : tool === 'delete' ? 'not-allowed' : tool === 'paint' ? 'crosshair' : tool === 'select' ? 'move' : 'default' }}
              onMouseDown={e => handleUnitMouseDown(e, u.id)}
              onMouseEnter={() => { if (tool === 'paint' && painting.current) onPaintUnit?.(u.id) }}>

              {/* Unit body */}
              <rect x={px} y={py} width={pw} height={ph}
                fill={isSelected ? 'rgba(191,239,255,0.10)' : fillColor}
                stroke={isSelected ? '#BFEFFF' : style.stroke}
                strokeWidth={isSelected ? 2 : 1}
                strokeDasharray={style.dash}
                rx={1}
              />

              {/* Progress fill overlay (PM view) */}
              {showProgress && u.progress_pct !== undefined && u.progress_pct > 0 && (
                <rect x={px + 1} y={py + ph - (ph * u.progress_pct / 100) + 1}
                  width={pw - 2} height={(ph * u.progress_pct / 100) - 2}
                  fill={progressColor(u.progress_pct)} rx={1}
                  style={{ pointerEvents: 'none' }} />
              )}

              {/* TOP LINE — urgency indicator
                  amber = high priority, red = critical
                  Spans full width so it reads as a band when scanning the map */}
              {u.urgency && u.urgency !== 'normal' && (
                <>
                  {u.urgency === 'critical' && (
                    <rect x={px} y={py} width={pw} height={4}
                      fill="#EF4444" opacity={0.9} rx={2}
                      style={{ pointerEvents: 'none' }} />
                  )}
                  {u.urgency === 'high' && (
                    <rect x={px} y={py} width={pw} height={3}
                      fill="#F59E0B" opacity={0.85} rx={2}
                      style={{ pointerEvents: 'none' }} />
                  )}
                </>
              )}

              {/* LEFT LINE — pending review indicator
                  Thin amber stripe on the left edge */}
              {u.status === 'pending_review' && (
                <rect x={px} y={py + 4} width={3} height={ph - 8}
                  fill="#F59E0B" opacity={0.9} rx={1}
                  style={{ pointerEvents: 'none' }} />
              )}

              {/* BOTTOM LINE — subcontractor assignment
                  4px colored band at the bottom edge.
                  Adjacent units with the same subcon visually merge
                  into a continuous strip — the "region" effect. */}
              {u.subcontractor_color && (
                <rect x={px} y={py + ph - 4} width={pw} height={4}
                  fill={u.subcontractor_color} rx={2}
                  style={{ pointerEvents: 'none' }} />
              )}

              {/* Resize handles — 4 corners + 4 edge midpoints. Only when a
                  single unit is selected; drag to resize width/height. */}
              {isSelected && !readOnly && tool === 'select' && selection.length === 1 && (
                <>
                  {([
                    { k: 'nw', hx: px,          hy: py,          cursor: 'nwse-resize' },
                    { k: 'n',  hx: px + pw / 2, hy: py,          cursor: 'ns-resize' },
                    { k: 'ne', hx: px + pw,     hy: py,          cursor: 'nesw-resize' },
                    { k: 'e',  hx: px + pw,     hy: py + ph / 2, cursor: 'ew-resize' },
                    { k: 'se', hx: px + pw,     hy: py + ph,     cursor: 'nwse-resize' },
                    { k: 's',  hx: px + pw / 2, hy: py + ph,     cursor: 'ns-resize' },
                    { k: 'sw', hx: px,          hy: py + ph,     cursor: 'nesw-resize' },
                    { k: 'w',  hx: px,          hy: py + ph / 2, cursor: 'ew-resize' },
                  ] as const).map(h => (
                    <rect key={h.k} x={h.hx - 4.5} y={h.hy - 4.5} width={9} height={9}
                      fill="#BFEFFF" stroke="#0A1628" strokeWidth={1.5} rx={1.5}
                      style={{ cursor: h.cursor }}
                      onMouseDown={e => handleResizeStart(e, u.id, h.k)} />
                  ))}
                </>
              )}

              {/* Unit label — always horizontal. Falls back to two lines
                  (e.g. "3F" / "18") in narrow lots so it stays readable instead
                  of shrinking to nothing. Hidden only if even two lines are tiny. */}
              {(() => {
                const text = u.label ?? u.unit_code
                if (!text) return null
                const dash = text.indexOf('-')
                const parts = dash > 0 ? [text.slice(0, dash), text.slice(dash + 1)] : null

                // Largest font that fits `chars` across and `lines` down.
                const fit = (chars: number, lines: number) =>
                  Math.min(13, (pw * 0.86) / (chars * 0.6), (ph * (lines === 1 ? 0.62 : 0.82)) / lines)

                const single = fit(text.length, 1)
                const twoChars = parts ? Math.max(parts[0].length, parts[1].length) : text.length
                const two = parts ? fit(twoChars, 2) : 0

                // Prefer two lines when it's clearly more legible (narrow lots).
                const useTwo = !!parts && two >= 6 && (two > single * 1.12 || single < 6)
                const fontSize = useTwo ? two : single
                if (fontSize < 6) return null

                const common = {
                  textAnchor: 'middle' as const,
                  fill: isSelected ? '#EAF7FF' : 'rgba(207,232,255,0.9)',
                  fontWeight: 500,
                  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                  style: { pointerEvents: 'none' as const },
                }
                if (useTwo && parts) {
                  return (
                    <text x={cx} y={cy} dominantBaseline="central" fontSize={fontSize} {...common}>
                      <tspan x={cx} dy="-0.55em">{parts[0]}</tspan>
                      <tspan x={cx} dy="1.1em">{parts[1]}</tspan>
                    </text>
                  )
                }
                return (
                  <text x={cx} y={cy} dominantBaseline="central" fontSize={fontSize} {...common}>{text}</text>
                )
              })()}
            </g>
          )
        })}

        {/* Draw draft rectangle */}
        {draft && draft.w > 2 && draft.h > 2 && (
          <rect x={draft.x} y={draft.y} width={draft.w} height={draft.h}
            fill="rgba(95,208,240,0.10)"
            stroke="#5FD0F0" strokeWidth={1.5}
            strokeDasharray="6,3" rx={1}
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Rubber-band selection rectangle */}
        {marqueeRect && (marqueeRect.w > 2 || marqueeRect.h > 2) && (
          <rect x={marqueeRect.x} y={marqueeRect.y} width={marqueeRect.w} height={marqueeRect.h}
            fill="rgba(96,165,250,0.10)"
            stroke="#60A5FA" strokeWidth={1} strokeDasharray="4,3"
            style={{ pointerEvents: 'none' }}
          />
        )}
      </svg>

      {/* Zoom controls */}
      {!readOnly && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1 px-1.5 py-1 rounded-lg"
          style={{ background: 'rgba(10,22,40,0.85)', border: '1px solid rgba(95,208,240,0.25)', backdropFilter: 'blur(8px)' }}>
          <button onClick={() => zoomBy(1 / 1.25)} title="Perkecil"
            className="w-6 h-6 rounded flex items-center justify-center text-[14px]"
            style={{ color: '#BFEFFF', background: 'rgba(95,208,240,0.08)' }}>−</button>
          <button onClick={fitView} title="Pas ke layar"
            className="px-2 h-6 rounded text-[11px] font-mono"
            style={{ color: '#BFEFFF', background: 'rgba(95,208,240,0.08)' }}>{Math.round(zoom * 100)}%</button>
          <button onClick={() => zoomBy(1.25)} title="Perbesar"
            className="w-6 h-6 rounded flex items-center justify-center text-[14px]"
            style={{ color: '#BFEFFF', background: 'rgba(95,208,240,0.08)' }}>+</button>
        </div>
      )}
    </div>
  )
}
