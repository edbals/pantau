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

export type Tool = 'select' | 'draw' | 'delete' | 'grid'

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
  bgImageUrl?: string
  readOnly?: boolean
  showProgress?: boolean
  onGridRect?: (rect: GridRect) => void  // fired when grid tool finishes drawing
}

const TYPE_STYLE: Record<UnitType, { stroke: string; fill: string; dash?: string }> = {
  house:       { stroke: '#60A5FA', fill: 'rgba(59,130,246,0.18)' },
  apartment:   { stroke: '#60A5FA', fill: 'rgba(59,130,246,0.18)' },
  villa:       { stroke: '#60A5FA', fill: 'rgba(59,130,246,0.18)' },
  shophouse:   { stroke: '#FCD34D', fill: 'rgba(245,158,11,0.18)' },
  commercial:  { stroke: '#FCD34D', fill: 'rgba(245,158,11,0.18)' },
  road:        { stroke: '#9CA3AF', fill: 'rgba(107,114,128,0.25)', dash: '4,3' },
  common_area: { stroke: '#34D399', fill: 'rgba(16,185,129,0.20)', dash: '4,3' },
  parking:     { stroke: '#9CA3AF', fill: 'rgba(107,114,128,0.18)', dash: '4,3' },
  facility:    { stroke: '#9CA3AF', fill: 'rgba(107,114,128,0.18)', dash: '4,3' },
  drainage:    { stroke: '#9CA3AF', fill: 'rgba(107,114,128,0.18)', dash: '4,3' },
  boundary:    { stroke: '#9CA3AF', fill: 'transparent', dash: '6,4' },
}

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
  tool, bgImageUrl, readOnly = false, showProgress = false, onGridRect,
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
  // Marquee (rubber-band) rectangle in screen px while drag-selecting.
  const marquee = useRef<{ startX: number; startY: number; additive: boolean } | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  // Effective selection: multi-select prop wins; otherwise the single id.
  const selection = selectedIds ?? (selectedId ? [selectedId] : [])
  const selectionSet = useMemo(() => new Set(selection), [selection.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const emitSelection = (ids: string[]) => {
    if (onSelectionChange) onSelectionChange(ids)
    else onSelect?.(ids[ids.length - 1] ?? null)
  }
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const frame = useMemo(
    () => imageSize && imageSize.src === bgImageUrl
      ? containFrame(svgSize.w, svgSize.h, imageSize.w, imageSize.h)
      : { x: 0, y: 0, w: svgSize.w, h: svgSize.h },
    [imageSize, bgImageUrl, svgSize]
  )

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
      if (!drawing.current && !dragging.current && !resizing.current && !marquee.current) return
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      if (marquee.current) {
        const { startX, startY } = marquee.current
        setMarqueeRect({
          x: Math.min(startX, x), y: Math.min(startY, y),
          w: Math.abs(x - startX), h: Math.abs(y - startY),
        })
        return
      }

      if (resizing.current) {
        const { id, handle, ox, oy, ow, oh, sx, sy } = resizing.current
        const dx = (x - sx) / frame.w
        const dy = (y - sy) / frame.h
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
        const dx = (x - sx) / frame.w
        const dy = (y - sy) / frame.h
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
          const { x, y } = clampToFrame(rawX, rawY, frame)
          const { startX, startY } = drawing.current
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
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [units, onChange, onSelect, onSelectionChange, selection, svgSize, frame, tool, onGridRect]) // eslint-disable-line react-hooks/exhaustive-deps

  function svgCoords(e: React.MouseEvent) {
    const svg = svgRef.current!
    const rect = svg.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handleSvgMouseDown(e: React.MouseEvent) {
    if (readOnly || e.button !== 0) return
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
    e.stopPropagation()
    if (e.button !== 0) return

    if (tool === 'delete') {
      onChange(units.filter(u => u.id !== id))
      emitSelection(selection.filter(s => s !== id))
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
          cursor: (tool === 'draw' || tool === 'grid') ? 'crosshair' : tool === 'delete' ? 'not-allowed' : 'default',
          background: 'repeating-linear-gradient(0deg,transparent,transparent 23px,rgba(255,255,255,.02) 24px),repeating-linear-gradient(90deg,transparent,transparent 23px,rgba(255,255,255,.02) 24px)',
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
              style={{ cursor: readOnly ? 'pointer' : tool === 'delete' ? 'not-allowed' : tool === 'select' ? 'move' : 'default' }}
              onMouseDown={e => handleUnitMouseDown(e, u.id)}>

              {/* Unit body */}
              <rect x={px} y={py} width={pw} height={ph}
                fill={fillColor}
                stroke={isSelected ? 'var(--accent)' : style.stroke}
                strokeWidth={isSelected ? 2.5 : 1.5}
                strokeDasharray={style.dash}
                rx={2}
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
                    <rect key={h.k} x={h.hx - 5} y={h.hy - 5} width={10} height={10}
                      fill="var(--accent)" stroke="#fff" strokeWidth={1.5} rx={2}
                      style={{ cursor: h.cursor }}
                      onMouseDown={e => handleResizeStart(e, u.id, h.k)} />
                  ))}
                </>
              )}

              {/* Unit label */}
              {pw > 24 && ph > 16 && (
                <text x={px + pw / 2} y={py + ph / 2 + 4}
                  textAnchor="middle"
                  fontSize={Math.max(8, Math.min(12, pw / 6))}
                  fill="rgba(240,244,255,0.85)"
                  fontWeight="600"
                  style={{ pointerEvents: 'none' }}>
                  {u.label ?? u.unit_code}
                </text>
              )}
            </g>
          )
        })}

        {/* Draw draft rectangle */}
        {draft && draft.w > 2 && draft.h > 2 && (
          <rect x={draft.x} y={draft.y} width={draft.w} height={draft.h}
            fill="rgba(124,58,237,0.12)"
            stroke="var(--accent)" strokeWidth={1.5}
            strokeDasharray="6,3" rx={2}
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
    </div>
  )
}
