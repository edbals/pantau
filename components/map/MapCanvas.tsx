'use client'

import { useRef, useState, useCallback, useEffect } from 'react'

export type UnitType =
  | 'house' | 'apartment' | 'shophouse' | 'commercial' | 'villa'
  | 'road' | 'common_area' | 'parking' | 'facility' | 'drainage' | 'boundary'

export interface CanvasUnit {
  id: string
  unit_code: string
  unit_type: UnitType
  x: number; y: number; width: number; height: number  // 0-1 normalised
  subcontractor_color?: string
  urgency?: 'normal' | 'high' | 'critical'
  progress_pct?: number
  status?: 'not_started' | 'in_progress' | 'pending_review' | 'completed'
  label?: string
}

type Tool = 'select' | 'draw' | 'delete'

interface Props {
  units: CanvasUnit[]
  onChange: (units: CanvasUnit[]) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  tool: Tool
  bgImageUrl?: string
  readOnly?: boolean
  showProgress?: boolean
}

const TYPE_STYLE: Record<UnitType, { stroke: string; fill: string; dash?: string }> = {
  house:       { stroke: '#3B82F6', fill: 'rgba(59,130,246,0.08)' },
  apartment:   { stroke: '#3B82F6', fill: 'rgba(59,130,246,0.08)' },
  villa:       { stroke: '#3B82F6', fill: 'rgba(59,130,246,0.08)' },
  shophouse:   { stroke: '#F59E0B', fill: 'rgba(245,158,11,0.08)' },
  commercial:  { stroke: '#F59E0B', fill: 'rgba(245,158,11,0.08)' },
  road:        { stroke: '#6B7280', fill: 'rgba(107,114,128,0.15)', dash: '4,3' },
  common_area: { stroke: '#10B981', fill: 'rgba(16,185,129,0.10)', dash: '4,3' },
  parking:     { stroke: '#6B7280', fill: 'rgba(107,114,128,0.08)', dash: '4,3' },
  facility:    { stroke: '#6B7280', fill: 'rgba(107,114,128,0.08)', dash: '4,3' },
  drainage:    { stroke: '#6B7280', fill: 'rgba(107,114,128,0.08)', dash: '4,3' },
  boundary:    { stroke: '#6B7280', fill: 'transparent', dash: '6,4' },
}

function progressColor(pct: number) {
  if (pct === 0) return 'transparent'
  if (pct < 25) return 'rgba(156,163,175,0.25)'
  if (pct < 50) return 'rgba(45,212,191,0.20)'
  if (pct < 75) return 'rgba(20,184,166,0.30)'
  if (pct < 100) return 'rgba(13,148,136,0.40)'
  return 'rgba(16,185,129,0.55)'
}

let uidCounter = 1
function uid() { return `u_${Date.now()}_${uidCounter++}` }

export default function MapCanvas({
  units, onChange, selectedId, onSelect, tool, bgImageUrl, readOnly = false, showProgress = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [svgSize, setSvgSize] = useState({ w: 800, h: 600 })
  const drawing = useRef<{ startX: number; startY: number } | null>(null)
  const dragging = useRef<{ id: string; ox: number; oy: number; sx: number; sy: number } | null>(null)
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setSvgSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function toNorm(px: number, py: number) {
    return { nx: px / svgSize.w, ny: py / svgSize.h }
  }

  function svgPoint(e: React.MouseEvent | React.TouchEvent) {
    const svg = svgRef.current!
    const rect = svg.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (readOnly) return
    e.preventDefault()
    const { x, y } = svgPoint(e)

    if (tool === 'draw') {
      drawing.current = { startX: x, startY: y }
      setDraft({ x, y, w: 0, h: 0 })
      onSelect(null)
    }
  }, [tool, readOnly, onSelect])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (readOnly) return
    const { x, y } = svgPoint(e)

    if (drawing.current) {
      const { startX, startY } = drawing.current
      setDraft({
        x: Math.min(startX, x), y: Math.min(startY, y),
        w: Math.abs(x - startX), h: Math.abs(y - startY),
      })
    }

    if (dragging.current) {
      const { id, ox, oy, sx, sy } = dragging.current
      const dx = (x - sx) / svgSize.w
      const dy = (y - sy) / svgSize.h
      onChange(units.map(u =>
        u.id === id
          ? { ...u, x: Math.max(0, Math.min(1 - u.width, ox + dx)), y: Math.max(0, Math.min(1 - u.height, oy + dy)) }
          : u
      ))
    }
  }, [readOnly, units, onChange, svgSize])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (readOnly) return
    const { x, y } = svgPoint(e)

    if (drawing.current) {
      const { startX, startY } = drawing.current
      const nw = Math.abs(x - startX) / svgSize.w
      const nh = Math.abs(y - startY) / svgSize.h
      if (nw > 0.02 && nh > 0.02) {
        const nx = Math.min(startX, x) / svgSize.w
        const ny = Math.min(startY, y) / svgSize.h
        const newUnit: CanvasUnit = {
          id: uid(), unit_code: `U-${String(units.length + 1).padStart(2, '0')}`,
          unit_type: 'house', x: nx, y: ny, width: nw, height: nh,
        }
        onChange([...units, newUnit])
        onSelect(newUnit.id)
      }
      drawing.current = null
      setDraft(null)
    }

    dragging.current = null
  }, [readOnly, units, onChange, onSelect, svgSize])

  function handleUnitMouseDown(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (readOnly) return

    if (tool === 'delete') {
      onChange(units.filter(u => u.id !== id))
      onSelect(null)
      return
    }

    if (tool === 'select') {
      onSelect(id)
      const u = units.find(uu => uu.id === id)!
      const { x, y } = svgPoint(e)
      dragging.current = { id, ox: u.x, oy: u.y, sx: x, sy: y }
    }
  }

  return (
    <svg
      ref={svgRef}
      className="w-full h-full"
      style={{
        cursor: tool === 'draw' ? 'crosshair' : tool === 'delete' ? 'not-allowed' : 'default',
        background: 'repeating-linear-gradient(0deg,transparent,transparent 23px,rgba(255,255,255,.02) 24px),repeating-linear-gradient(90deg,transparent,transparent 23px,rgba(255,255,255,.02) 24px)',
        userSelect: 'none',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Background site plan image */}
      {bgImageUrl && (
        <image href={bgImageUrl} x={0} y={0} width="100%" height="100%" opacity={0.4} preserveAspectRatio="xMidYMid meet" />
      )}

      {/* Units */}
      {units.map(u => {
        const px = u.x * svgSize.w
        const py = u.y * svgSize.h
        const pw = u.width * svgSize.w
        const ph = u.height * svgSize.h
        const style = TYPE_STYLE[u.unit_type] ?? TYPE_STYLE.house
        const isSelected = u.id === selectedId
        const fillColor = showProgress && u.progress_pct !== undefined
          ? progressColor(u.progress_pct)
          : (u.subcontractor_color ? u.subcontractor_color + '22' : style.fill)

        return (
          <g key={u.id} style={{ cursor: tool === 'delete' ? 'not-allowed' : tool === 'select' ? 'move' : 'default' }}
            onMouseDown={e => handleUnitMouseDown(e, u.id)}>

            <rect x={px} y={py} width={pw} height={ph}
              fill={fillColor}
              stroke={u.subcontractor_color ?? style.stroke}
              strokeWidth={isSelected ? 2 : 1}
              strokeDasharray={style.dash}
              rx={2}
            />

            {/* Progress fill overlay */}
            {showProgress && u.progress_pct !== undefined && u.progress_pct > 0 && (
              <rect x={px + 1} y={py + ph - (ph * u.progress_pct / 100) + 1}
                width={pw - 2} height={(ph * u.progress_pct / 100) - 2}
                fill={progressColor(u.progress_pct)} rx={1} />
            )}

            {/* Selection handles */}
            {isSelected && (
              <>
                {[{cx:px,cy:py},{cx:px+pw,cy:py},{cx:px,cy:py+ph},{cx:px+pw,cy:py+ph}].map((h,i) => (
                  <circle key={i} cx={h.cx} cy={h.cy} r={5} fill="var(--accent)" stroke="#fff" strokeWidth={1.5} />
                ))}
              </>
            )}

            {/* Label */}
            {pw > 30 && ph > 20 && (
              <text x={px + pw / 2} y={py + ph / 2 + 4} textAnchor="middle"
                fontSize={Math.max(9, Math.min(13, pw / 6))} fill="rgba(240,244,255,0.8)" fontWeight="600">
                {u.label ?? u.unit_code}
              </text>
            )}

            {/* Urgency badge */}
            {u.urgency && u.urgency !== 'normal' && (
              <circle cx={px + pw - 6} cy={py + 6} r={4}
                fill={u.urgency === 'critical' ? 'var(--red)' : 'var(--amber)'} />
            )}

            {/* Pending review pulse dot */}
            {u.status === 'pending_review' && (
              <circle cx={px + 6} cy={py + 6} r={4} fill="var(--amber)" opacity={0.9} />
            )}
          </g>
        )
      })}

      {/* Draw draft */}
      {draft && draft.w > 2 && draft.h > 2 && (
        <rect x={draft.x} y={draft.y} width={draft.w} height={draft.h}
          fill="rgba(124,58,237,0.10)" stroke="var(--accent)" strokeWidth={1.5}
          strokeDasharray="6,3" rx={2} />
      )}
    </svg>
  )
}
