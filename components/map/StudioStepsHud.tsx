'use client'

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
}

// A blueprint-styled progress HUD that floats over the canvas and highlights
// the next step the user needs to take. The first not-done, non-optional step
// is the "active" one. Read-only workflow bar — the AI copilot now lives in a
// dedicated bottom-left floating button (see CopilotFab), not in this stepper.
export default function StudioStepsHud({ steps }: Props) {
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
          <div key={step.key} className="flex items-center">
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
            {i < steps.length - 1 && (
              <span className="mx-0.5" style={{ color: 'rgba(150,185,225,0.3)' }}>›</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
