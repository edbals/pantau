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
  selectedId: string | null
  onSelect: (id: string | null) => void
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
  units, onChange, selectedId, onSelect, tool, bgImageUrl, readOnly = false, showProgress = false, onGridRect,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [svgSize, setSvgSize] = useState({ w: 800, h: 600 })
  const [imageSize, setImageSize] = useState<{ src: string; w: number; h: number } | null>(null)
  const drawing = useRef<{ startX: number; startY: number } | null>(null)
  const dragging = useRef<{ id: string; ox: number; oy: number; sx: number; sy: number } | null>(null)
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
      if (!drawing.current && !dragging.current) return
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      if (drawing.current) {
        const point = clampToFrame(x, y, frame)
        const { startX, startY } = drawing.current
        setDraft({
          x: Math.min(startX, point.x), y: Math.min(startY, point.y),
          w: Math.abs(point.x - startX), h: Math.abs(point.y - startY),
        })
      }
      if (dragging.current) {
        const { id, ox, oy, sx, sy } = dragging.current
        const dx = (x - sx) / frame.w
        const dy = (y - sy) / frame.h
        onChange(units.map(u =>
          u.id === id
            ? { ...u, x: Math.max(0, Math.min(1 - u.width, ox + dx)), y: Math.max(0, Math.min(1 - u.height, oy + dy)) }
            : u
        ))
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
              onSelect(newUnit.id)
            }
          }
        }
        drawing.current = null
        setDraft(null)
      }
      dragging.current = null
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [units, onChange, onSelect, svgSize, frame, tool, onGridRect])

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
      onSelect(null)
    }
  }

  function handleUnitMouseDown(e: React.MouseEvent, id: string) {
    if (readOnly) return
    e.stopPropagation()
    if (e.button !== 0) return

    if (tool === 'delete') {
      onChange(units.filter(u => u.id !== id))
      onSelect(null)
      return
    }
    if (tool === 'select') {
      onSelect(id)
      const u = units.find(uu => uu.id === id)!
      const { x, y } = svgCoords(e)
      dragging.current = { id, ox: u.x, oy: u.y, sx: x, sy: y }
    }
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
          const isSelected = u.id === selectedId
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

              {/* Selection corner handles */}
              {isSelected && !readOnly && (
                <>
                  {[{ cx: px, cy: py }, { cx: px + pw, cy: py }, { cx: px, cy: py + ph }, { cx: px + pw, cy: py + ph }].map((h, i) => (
                    <circle key={i} cx={h.cx} cy={h.cy} r={5}
                      fill="var(--accent)" stroke="#fff" strokeWidth={1.5}
                      style={{ pointerEvents: 'none' }} />
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
      </svg>
    </div>
  )
}
