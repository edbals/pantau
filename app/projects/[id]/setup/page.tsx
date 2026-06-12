import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { Contact } from '@/lib/types/database'
import ProjectTeamSetup from '@/components/directory/ProjectTeamSetup'

export default async function ProjectSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [projectRes, contactsRes, teamRes] = await Promise.all([
    supabase.from('projects').select('name, project_code').eq('id', id).single(),
    supabase.from('contacts').select('*').order('created_at', { ascending: false }),
    supabase.from('project_team_members').select('contact_id').eq('project_id', id),
  ])

  const project = projectRes.data as { name: string; project_code: string } | null
  if (!project) redirect('/dashboard')

  const selectedIds = (teamRes.data ?? []).map(r => (r as { contact_id: string }).contact_id)

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>
      <nav className="h-[52px] flex items-center px-5 gap-3 flex-shrink-0"
        style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
        <Link href={`/projects/${id}`} className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--t2)' }}>
          <ArrowLeft size={16} /> {project.name}
        </Link>
        <span className="text-[11px] px-2 py-0.5 rounded font-mono"
          style={{ background: 'var(--bg-3)', color: 'var(--t3)' }}>{project.project_code}</span>
      </nav>

      <main className="flex-1 p-6 md:p-8 max-w-3xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--t1)' }}>Siapkan Tim Proyek</h1>
          <p className="text-sm" style={{ color: 'var(--t3)' }}>
            Pilih siapa saja dari roster perusahaan yang terlibat di proyek ini. Hanya mereka yang bisa ditugaskan ke unit di peta.
          </p>
        </div>

        <ProjectTeamSetup
          projectId={id}
          initialContacts={(contactsRes.data ?? []) as Contact[]}
          initialSelectedIds={selectedIds}
        />
      </main>
    </div>
  )
}
