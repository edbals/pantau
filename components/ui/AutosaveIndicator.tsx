'use client'

import { Loader2, Check } from 'lucide-react'

export type AutosaveStatus = 'idle' | 'saving' | 'saved'

// Subtle, premium top-left trust indicator. Low-opacity, tiny type — it should
// reassure, not shout. Reused by Map Studio and the Directory/Setup pages.
export default function AutosaveIndicator({ status }: { status: AutosaveStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] select-none" style={{ color: 'var(--t3)' }}>
      {status === 'saving' ? (
        <>
          <Loader2 size={11} className="animate-spin" />
          Menyimpan…
        </>
      ) : (
        <>
          <Check size={11} style={{ color: 'var(--green)', opacity: 0.65 }} />
          Tersimpan otomatis
        </>
      )}
    </span>
  )
}
