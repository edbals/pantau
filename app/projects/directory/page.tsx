import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { Contact, UserRole } from '@/lib/types/database'
import DirectoryRoster from '@/components/directory/DirectoryRoster'

const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Pemilik', project_manager: 'Manajer Proyek',
  koordinator: 'Koordinator', pengawas: 'Pengawas',
}

export default async function DirectoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('full_name, role, org_id').eq('id', user.id).single()
  const p = profile as { full_name: string; role: UserRole; org_id: string | null } | null

  const orgRes = p?.org_id
    ? await supabase.from('organisations').select('name').eq('id', p.org_id).single()
    : null
  const orgName = (orgRes?.data as { name: string } | null)?.name ?? ''

  const { data: contacts } = await supabase
    .from('contacts').select('*').order('created_at', { ascending: false })

  const canManage = p?.role === 'owner' || p?.role === 'project_manager'

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>

      {/* Nav */}
      <nav className="h-[52px] flex items-center px-5 gap-3 flex-shrink-0"
        style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
        <Link href="/dashboard" className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--t2)' }}>
          <ArrowLeft size={16} /> Proyek
        </Link>
        <div className="flex-1" />
        <span className="text-[12px] hidden sm:block" style={{ color: 'var(--t3)' }}>{orgName}</span>
        <span className="text-[11px] font-semibold px-2 py-1 rounded-full"
          style={{ background: 'var(--accent-sub)', color: 'var(--accent-2)', border: '1px solid rgba(124,58,237,0.25)' }}>
          {p ? ROLE_LABELS[p.role] : ''}
        </span>
      </nav>

      <main className="flex-1 p-6 md:p-8 max-w-6xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--t1)' }}>Direktori Tim</h1>
          <p className="text-sm" style={{ color: 'var(--t3)' }}>
            Roster kontak perusahaan{orgName ? ` — ${orgName}` : ''}. Dipakai ulang di semua proyek.
          </p>
        </div>

        <DirectoryRoster initialContacts={(contacts ?? []) as Contact[]} canManage={canManage} />
      </main>
    </div>
  )
}
