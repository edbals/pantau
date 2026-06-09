'use client'

import type { SkipRule } from '@/lib/digitize/numbering'

interface Props {
  rules: SkipRule[]
  onChange?: (next: SkipRule[]) => void
  // Read-only renders a compact summary (used to show inherited project rules).
  readOnly?: boolean
  // Seed number for a freshly added rule (e.g. a block's start number).
  defaultTarget?: number
}

// The shared "Aturan Nomor" editor: a list of per-number skip/replace rules.
// Used both for project-wide global rules and for a single block's local rules.
export default function NumberRulesTable({ rules, onChange, readOnly = false, defaultTarget = 1 }: Props) {
  const set = (next: SkipRule[]) => onChange?.(next)
  const addRule = () => {
    const used = new Set(rules.map(r => r.target))
    let t = defaultTarget
    while (used.has(t)) t++
    set([...rules, { target: t, action: 'skip' }])
  }

  if (readOnly) {
    return rules.length === 0 ? (
      <p className="text-[10px]" style={{ color: 'var(--t3)' }}>Belum ada aturan proyek.</p>
    ) : (
      <div className="space-y-1">
        {rules.map((r, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--t2)' }}>
            <span className="font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-3)' }}>{r.target}</span>
            <span style={{ color: 'var(--t3)' }}>
              {r.action === 'skip' ? 'Lewati' : `Ganti → ${r.value || '—'}`}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px]" style={{ color: 'var(--t3)' }}>Aturan Nomor</label>
        <button onClick={addRule}
          className="text-[10px] px-1.5 py-0.5 rounded font-medium"
          style={{ background: 'var(--accent-sub)', color: 'var(--accent-2)' }}>+ Tambah</button>
      </div>
      {rules.length === 0 && (
        <p className="text-[10px]" style={{ color: 'var(--t3)' }}>Tidak ada — semua nomor urut.</p>
      )}
      {rules.map((rule, i) => (
        <div key={i} className="flex items-center gap-1 mb-1">
          <input type="number" min={1} value={rule.target} title="Nomor"
            onChange={e => set(rules.map((r, idx) => idx === i ? { ...r, target: Math.max(1, parseInt(e.target.value) || 1) } : r))}
            className="w-11 px-1 py-1 rounded text-[11px] text-center font-mono outline-none"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
          <button
            onClick={() => set(rules.map((r, idx) => idx === i ? { ...r, action: r.action === 'skip' ? 'replace' : 'skip' } : r))}
            className="px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap"
            style={{ background: 'var(--bg-3)', border: '1px solid var(--border-md)', color: rule.action === 'replace' ? 'var(--accent-2)' : 'var(--t2)' }}>
            {rule.action === 'skip' ? 'Lewati' : 'Ganti'}
          </button>
          {rule.action === 'replace' && (
            <input value={rule.value ?? ''} placeholder="cth. 3A"
              onChange={e => set(rules.map((r, idx) => idx === i ? { ...r, value: e.target.value } : r))}
              className="flex-1 w-full px-1.5 py-1 rounded text-[11px] font-mono outline-none"
              style={{ background: 'var(--bg-2)', border: '1px solid var(--border-md)', color: 'var(--t1)' }} />
          )}
          <button onClick={() => set(rules.filter((_, idx) => idx !== i))}
            className="px-1.5 py-1 rounded text-[11px] flex-shrink-0"
            style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--red)' }}>×</button>
        </div>
      ))}
    </div>
  )
}
