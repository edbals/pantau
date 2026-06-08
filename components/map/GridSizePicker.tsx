'use client'

import { useState } from 'react'

interface Props {
  rows: number
  cols: number
  onChange: (rows: number, cols: number) => void
  maxRows?: number
  maxCols?: number
}

const MIN_ROWS = 5
const MIN_COLS = 8
const CELL = 13   // px
const GAP = 2     // px

// Google-Docs-style table picker: hover/drag over the matrix to choose
// rows × columns. The matrix grows toward the edges as you approach them.
export default function GridSizePicker({ rows, cols, onChange, maxRows = 25, maxCols = 40 }: Props) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null)

  const selR = hover?.r ?? rows
  const selC = hover?.c ?? cols
  // Show a couple of cells beyond the current selection, clamped to the max.
  const showRows = Math.min(maxRows, Math.max(MIN_ROWS, selR + 1, rows))
  const showCols = Math.min(maxCols, Math.max(MIN_COLS, selC + 1, cols))

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="overflow-auto max-w-full p-1 rounded-lg"
        style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)' }}
        onMouseLeave={() => setHover(null)}
      >
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${showCols}, ${CELL}px)`, gap: `${GAP}px` }}>
          {Array.from({ length: showRows }).flatMap((_, r) =>
            Array.from({ length: showCols }).map((__, c) => {
              const active = r < selR && c < selC
              return (
                <div
                  key={`${r}-${c}`}
                  onMouseEnter={() => setHover({ r: r + 1, c: c + 1 })}
                  onMouseDown={() => onChange(r + 1, c + 1)}
                  style={{
                    width: CELL, height: CELL, borderRadius: 2, cursor: 'pointer',
                    background: active ? 'rgba(95,208,240,0.35)' : 'var(--bg-3)',
                    border: `1px solid ${active ? '#5FD0F0' : 'var(--border)'}`,
                  }}
                />
              )
            })
          )}
        </div>
      </div>
      <div className="text-[12px] font-mono" style={{ color: 'var(--accent-2)' }}>
        {selR} baris × {selC} kolom
      </div>
    </div>
  )
}
