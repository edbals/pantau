'use client'

import { Sparkles, Loader2 } from 'lucide-react'

export interface StudioStep {
  key: string
  label: string
  done: boolean
  detail?: string
  optional?: boolean
  onClick?: () => void
}

interface Props {
  steps: StudioStep[]
  // Fired by the active step's "Tanya AI" button — parent calls the AI copilot.
  onAskAI?: (stepKey: string) => void
  copilotMessage?: string | null
  copilotLoading?: boolean
}

// A blueprint-styled progress HUD that floats over the canvas and highlights
// the next step the user needs to take. The first not-done, non-optional step
// is the "active" one.
export default function StudioStepsHud({ steps, onAskAI, copilotMessage, copilotLoading }: Props) {
  const activeIndex = steps.findIndex(s => !s.done && !s.optional)

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-2 py-1.5 rounded-xl"
      style={{
        background: 'rgba(10,22,40,0.82)',
        border: '1px solid rgba(95,208,240,0.25)',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
      }}>
      {steps.map((step, i) => {
        const isActive = i === activeIndex
        const accent = step.done ? '#5FD0F0' : isActive ? '#BFEFFF' : 'rgba(150,185,225,0.45)'
        return (
          <div key={step.key} className="relative flex items-center">
            {/* Copilot tooltip — anchored under the active step's Tanya AI button */}
            {isActive && onAskAI && (copilotLoading || copilotMessage) && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-20 w-56 px-3 py-2 rounded-lg text-[11px] leading-snug"
                style={{
                  background: 'rgba(17,12,34,0.96)', border: '1px solid rgba(124,58,237,0.5)',
                  color: '#EDE9FE', boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
                }}>
                <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45"
                  style={{ background: 'rgba(17,12,34,0.96)', borderLeft: '1px solid rgba(124,58,237,0.5)', borderTop: '1px solid rgba(124,58,237,0.5)' }} />
                {copilotLoading
                  ? <span className="flex items-center gap-1.5" style={{ color: '#C4B5FD' }}><Loader2 size={12} className="animate-spin" /> Menganalisis…</span>
                  : <span className="flex items-start gap-1.5"><Sparkles size={12} className="mt-0.5 flex-shrink-0" style={{ color: '#C4B5FD' }} />{copilotMessage}</span>}
              </div>
            )}
            <button
              onClick={step.onClick}
              disabled={!step.onClick}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors"
              style={{
                background: isActive ? 'rgba(95,208,240,0.12)' : 'transparent',
                cursor: step.onClick ? 'pointer' : 'default',
              }}
            >
              <span
                className="flex items-center justify-center rounded-full text-[10px] font-bold flex-shrink-0"
                style={{
                  width: 16, height: 16,
                  background: step.done ? '#5FD0F0' : 'transparent',
                  border: `1.5px solid ${accent}`,
                  color: step.done ? '#0A1628' : accent,
                }}
              >
                {step.done ? '✓' : i + 1}
              </span>
              <span className="text-[11px] font-medium whitespace-nowrap" style={{ color: accent }}>
                {step.label}
                {step.detail && <span className="ml-1 font-mono opacity-80">{step.detail}</span>}
              </span>
            </button>
            {isActive && onAskAI && (
              <button
                onClick={() => onAskAI(step.key)}
                title="Tanya AI — tunjukkan caranya"
                className="ml-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-semibold transition-colors"
                style={{ background: 'rgba(124,58,237,0.28)', color: '#C4B5FD', border: '1px solid rgba(124,58,237,0.4)' }}>
                <Sparkles size={10} /> Tanya AI
              </button>
            )}
            {i < steps.length - 1 && (
              <span className="mx-0.5" style={{ color: 'rgba(150,185,225,0.3)' }}>›</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
