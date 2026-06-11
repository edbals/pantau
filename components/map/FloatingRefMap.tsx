'use client'

import { useRef, useState } from 'react'
import { X, GripHorizontal } from 'lucide-react'

interface Props {
  imageUrl: string
  onClose: () => void
}

const MIN_WIDTH = 160
const MAX_WIDTH = 640

// Floating, draggable AND resizable picture-in-picture window showing the
// original (un-faded) blueprint, so the user can compare their schematic
// against the real denah while editing. Dragged by its header; resized from the
// bottom-right handle. Height follows the image's natural aspect ratio (the
// <img> is width-driven with height:auto), so the aspect is always preserved.
export default function FloatingRefMap({ imageUrl, onClose }: Props) {
  const [pos, setPos] = useState({ x: 16, y: 56 })
  const [width, setWidth] = useState(280)
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const resize = useRef<{ sx: number; ow: number } | null>(null)

  function onHeaderPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onHeaderPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    const { sx, sy, ox, oy } = drag.current
    setPos({ x: Math.max(0, ox + e.clientX - sx), y: Math.max(0, oy + e.clientY - sy) })
  }
  function endHeader() { drag.current = null }

  function onResizePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    resize.current = { sx: e.clientX, ow: width }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onResizePointerMove(e: React.PointerEvent) {
    if (!resize.current) return
    const next = resize.current.ow + (e.clientX - resize.current.sx)
    setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, next)))
  }
  function endResize() { resize.current = null }

  return (
    <div className="absolute z-30 rounded-xl overflow-hidden select-none"
      style={{
        left: pos.x, top: pos.y, width,
        background: 'var(--bg-1)', border: '1px solid var(--border-md)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}>
      <div
        className="flex items-center justify-between px-2.5 py-1.5 cursor-grab active:cursor-grabbing"
        style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', touchAction: 'none' }}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={endHeader}
        onPointerCancel={endHeader}>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase" style={{ color: 'var(--t3)' }}>
          <GripHorizontal size={12} /> Denah Asli
        </span>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onClose() }}
          title="Tutup"
          className="flex items-center justify-center w-5 h-5 rounded hover:opacity-100 opacity-70"
          style={{ color: 'var(--t2)' }}>
          <X size={13} />
        </button>
      </div>

      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Denah asli" draggable={false}
          className="block w-full h-auto" style={{ background: '#fff' }} />

        {/* Bottom-right resize handle (width-only; height follows aspect) */}
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          style={{ touchAction: 'none' }}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}>
          <svg viewBox="0 0 16 16" className="w-full h-full">
            <path d="M16 6 L6 16 M16 11 L11 16" stroke="var(--accent-2)" strokeWidth={1.5} fill="none" />
          </svg>
        </div>
      </div>
    </div>
  )
}
