'use client'

import { useEffect, useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'

interface Props {
  onAsk: () => void
  loading: boolean
  message: string | null
  unitCount: number
}

const PHASE_INTERVAL_MS = 600

// Phased "thinking" micro-copy. Rendered ONLY while loading, so each request
// remounts it and the phase resets to 0 naturally — no in-effect setState.
function ThinkingText({ unitCount }: { unitCount: number }) {
  const [phase, setPhase] = useState(0)

  const phases = [
    'Membaca struktur kanvas…',
    `Menganalisis geometri untuk ${unitCount} unit…`,
    'Menyusun langkah efisiensi berikutnya…',
  ]

  // Advance every ~600ms and hold on the last phase until the reply lands.
  useEffect(() => {
    const id = window.setInterval(() => setPhase(p => Math.min(p + 1, 2)), PHASE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [])

  return <span className="copilot-shimmer-text font-medium">{phases[phase]}</span>
}

// Standalone, viewport-fixed AI copilot. Lives bottom-left — clear of the
// canvas controls (top) and the autosave toasts (bottom-right). Glassmorphism
// shell; a soft purple ring glows while the request is in flight.
export default function CopilotFab({ onAsk, loading, message, unitCount }: Props) {
  const showPanel = loading || !!message

  return (
    <div className="fixed bottom-6 left-6 z-30 flex flex-col items-start gap-2">
      {showPanel && (
        <div className="max-w-[280px] px-3.5 py-2.5 rounded-xl text-[12px] leading-snug backdrop-blur-md"
          style={{
            background: 'rgba(17,12,34,0.82)',
            border: '1px solid rgba(124,58,237,0.45)',
            color: '#EDE9FE',
            boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
          }}>
          {loading ? (
            <span className="flex items-center gap-2">
              <Loader2 size={13} className="animate-spin flex-shrink-0" style={{ color: '#C4B5FD' }} />
              <ThinkingText unitCount={unitCount} />
            </span>
          ) : (
            <span className="flex items-start gap-2">
              <Sparkles size={13} className="mt-0.5 flex-shrink-0" style={{ color: '#C4B5FD' }} />
              <span>{message}</span>
            </span>
          )}
        </div>
      )}

      <button
        onClick={onAsk}
        disabled={loading}
        title="Tanya AI — minta saran langkah berikutnya"
        className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-semibold backdrop-blur-md transition-all ${loading ? 'ring-2 ring-purple-500/50' : ''}`}
        style={{
          background: 'rgba(17,18,28,0.80)',
          border: '1px solid rgba(124,58,237,0.35)',
          color: '#EDE9FE',
          boxShadow: loading
            ? '0 0 22px rgba(124,58,237,0.45)'
            : '0 8px 24px rgba(0,0,0,0.4)',
          cursor: loading ? 'default' : 'pointer',
        }}>
        {loading
          ? <Loader2 size={15} className="animate-spin" style={{ color: '#C4B5FD' }} />
          : <Sparkles size={15} style={{ color: '#C4B5FD' }} />}
        Tanya AI
      </button>
    </div>
  )
}
