import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { UserRole, ProjectStatus } from '@/lib/types/database'
import SignOutButton from './sign-out-button'

const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Pemilik', project_manager: 'Manajer Proyek',
  koordinator: 'Koordinator', pengawas: 'Pengawas',
}

const STATUS_LABEL: Record<ProjectStatus, string> = {
  setup: 'Setup', active: 'Aktif', on_hold: 'Ditahan',
  completed: 'Selesai', archived: 'Diarsip',
}

const STATUS_COLOR: Record<ProjectStatus, string> = {
  setup: 'var(--t3)',
  active: 'var(--green)',
  on_hold: 'var(--amber)',
  completed: 'var(--blue)',
  archived: 'var(--t3)',
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileRes, projectsRes] = await Promise.all([
    supabase.from('users').select('full_name, role, org_id').eq('id', user.id).single(),
    supabase.from('projects').select('id, name, project_code, project_type, status, go_live_at, created_at').order('created_at', { ascending: false }),
  ])

  const profile = profileRes.data as { full_name: string; role: UserRole; org_id: string } | null
  const projects = (projectsRes.data ?? []) as Array<{
    id: string; name: string; project_code: string; project_type: string;
    status: ProjectStatus; go_live_at: string | null; created_at: string;
  }>

  const orgRes = profile?.org_id
    ? await supabase.from('organisations').select('name').eq('id', profile.org_id).single()
    : null
  const orgName = (orgRes?.data as { name: string } | null)?.name ?? ''

  const isOwner = profile?.role === 'owner' || profile?.role === 'project_manager'

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>

      {/* Nav */}
      <nav className="h-[52px] flex items-center px-5 gap-3 flex-shrink-0"
        style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 mr-4">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center font-extrabold text-white text-[13px]"
            style={{ background: 'var(--accent)', boxShadow: '0 0 12px var(--accent-glow)' }}>P</div>
          <span className="font-bold text-[15px]" style={{ color: 'var(--t1)' }}>Pantau</span>
        </div>
        <Link href="/projects/directory" className="text-[12px] font-medium hover:opacity-80" style={{ color: 'var(--t2)' }}>
          Direktori Tim
        </Link>
        <div className="flex-1" />
        <span className="text-[12px] hidden sm:block" style={{ color: 'var(--t3)' }}>{orgName}</span>
        <span className="text-[11px] font-semibold px-2 py-1 rounded-full"
          style={{ background: 'var(--accent-sub)', color: 'var(--accent-2)', border: '1px solid rgba(124,58,237,0.25)' }}>
          {profile ? ROLE_LABELS[profile.role] : ''}
        </span>
        <SignOutButton />
      </nav>

      <main className="flex-1 p-6 md:p-8 max-w-6xl mx-auto w-full">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--t1)' }}>Proyek</h1>
            <p className="text-sm" style={{ color: 'var(--t3)' }}>{orgName}</p>
          </div>
          {isOwner && (
            <Link href="/projects/new"
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: 'var(--accent)', boxShadow: '0 0 16px var(--accent-glow)' }}>
              + Proyek Baru
            </Link>
          )}
        </div>

        {/* Project grid */}
        {projects.length === 0 ? (
          <div className="rounded-xl p-12 text-center"
            style={{ background: 'var(--bg-1)', border: '1px dashed var(--border-md)' }}>
            <div className="text-4xl mb-4">🏗️</div>
            <p className="text-base font-semibold mb-2" style={{ color: 'var(--t2)' }}>Belum ada proyek</p>
            {isOwner ? (
              <p className="text-sm mb-6" style={{ color: 'var(--t3)' }}>Buat proyek pertama untuk memulai</p>
            ) : (
              <p className="text-sm" style={{ color: 'var(--t3)' }}>Anda belum ditugaskan ke proyek manapun</p>
            )}
            {isOwner && (
              <Link href="/projects/new"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
                style={{ background: 'var(--accent)', boxShadow: '0 0 16px var(--accent-glow)' }}>
                + Buat Proyek
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(p => (
              <Link key={p.id} href={`/projects/${p.id}`}
                className="block rounded-xl p-5 card-hover"
                style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>

                {/* Status dot + code */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-bold tracking-wider px-2 py-1 rounded"
                    style={{ background: 'var(--bg-3)', color: 'var(--t3)' }}>
                    {p.project_code}
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] font-medium"
                    style={{ color: STATUS_COLOR[p.status] }}>
                    <span className="w-1.5 h-1.5 rounded-full inline-block"
                      style={{ background: STATUS_COLOR[p.status] }} />
                    {STATUS_LABEL[p.status]}
                  </span>
                </div>

                <h3 className="font-semibold text-[15px] mb-1 leading-tight" style={{ color: 'var(--t1)' }}>
                  {p.name}
                </h3>
                <p className="text-[12px] capitalize" style={{ color: 'var(--t3)' }}>
                  {p.project_type}
                </p>

                {/* Progress bar placeholder */}
                <div className="mt-4">
                  <div className="flex justify-between text-[11px] mb-1.5" style={{ color: 'var(--t3)' }}>
                    <span>Progres</span>
                    <span>0%</span>
                  </div>
                  <div className="h-1 rounded-full" style={{ background: 'var(--bg-3)' }}>
                    <div className="h-1 rounded-full" style={{ width: '0%', background: 'var(--accent)' }} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
