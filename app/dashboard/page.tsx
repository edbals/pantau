import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/lib/types/database'

// Role labels in Indonesian
const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Pemilik',
  project_manager: 'Manajer Proyek',
  koordinator: 'Koordinator',
  pengawas: 'Pengawas',
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const result = await supabase
    .from('users')
    .select('full_name, role')
    .eq('id', user.id)
    .single()
  const profile = result.data as { full_name: string; role: UserRole } | null

  return (
    <div
      className="min-h-screen p-8"
      style={{ background: 'var(--bg-base)', color: 'var(--t1)' }}
    >
      {/* Placeholder header */}
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center font-extrabold text-white text-sm"
            style={{ background: 'var(--accent)', boxShadow: '0 0 16px var(--accent-glow)' }}
          >
            P
          </div>
          <span className="font-bold text-[15px]" style={{ color: 'var(--t1)' }}>
            Pantau
          </span>
        </div>

        {profile ? (
          <>
            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--t1)' }}>
              Selamat datang, {profile.full_name}
            </h1>
            <p className="text-sm mb-8" style={{ color: 'var(--t2)' }}>
              {ROLE_LABELS[profile.role as UserRole] ?? profile.role}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--t1)' }}>
              Dashboard
            </h1>
            <p className="text-sm mb-8" style={{ color: 'var(--t2)' }}>
              Profil Anda belum diatur. Hubungi administrator.
            </p>
          </>
        )}

        {/* Phase 1 placeholder — will be replaced in Phase 2 */}
        <div
          className="rounded-xl p-6 text-center"
          style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--t3)' }}>
            Dashboard proyek akan hadir di Phase 2 — Map Studio
          </p>
        </div>
      </div>
    </div>
  )
}
