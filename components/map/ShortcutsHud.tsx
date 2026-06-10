'use client'

// Bottom-left input cheatsheet shown while the Select tool is active. Pure
// reference — no interactivity. Modern, full-sentence Bahasa copy.
const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Klik & seret', label: 'untuk memilih beberapa unit' },
  { keys: 'Shift + Klik', label: 'untuk menambah pilihan' },
  { keys: 'Delete', label: 'untuk menghapus' },
  { keys: 'Tahan Alt', label: 'untuk mematikan Magnet/Snapping' },
]

export default function ShortcutsHud() {
  return (
    <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1 px-3 py-2 rounded-lg text-[10px]"
      style={{
        background: 'rgba(10,22,40,0.82)',
        border: '1px solid rgba(95,208,240,0.2)',
        color: 'rgba(207,232,255,0.75)',
        backdropFilter: 'blur(8px)',
        maxWidth: 'calc(100% - 120px)',
      }}>
      {SHORTCUTS.map(s => (
        <span key={s.keys}>
          <b style={{ color: '#BFEFFF' }}>{s.keys}</b> {s.label}
        </span>
      ))}
    </div>
  )
}
