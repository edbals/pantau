import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireRole } from '@/lib/api/auth'
import { ok, err } from '@/lib/api/response'
import type { Contact } from '@/lib/types/database'

// GET /api/v1/projects/:id/team — the roster contacts assigned to this project.
// Returns full Contact rows (resolved through the join) for any project member.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)

  const { id } = await params
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('project_team_members')
    .select('contact:contacts(*)')
    .eq('project_id', id)

  if (error) return err(error.message, 500)
  // Flatten { contact: {...} } → Contact[], dropping any orphaned join rows.
  // The embedded relation is to-one at runtime; our hand-written Database type
  // carries no FK metadata, so cast through unknown.
  const rows = (data ?? []) as unknown as { contact: Contact | null }[]
  const contacts = rows.map(r => r.contact).filter((c): c is Contact => !!c)
  return ok(contacts)
}

// PUT /api/v1/projects/:id/team — replace the project's team with contact_ids.
// Owner / project_manager only; RLS additionally enforces project-admin.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)
  if (!requireRole(ctx, ['owner', 'project_manager'])) return err('Forbidden', 403)

  const { id } = await params
  const body = await request.json().catch(() => null)
  if (!body || !Array.isArray(body.contact_ids)) return err('contact_ids array is required', 400)

  const requestedIds = [...new Set(body.contact_ids.map((x: unknown) => String(x)))]
  const supabase = await createClient()

  // Only keep ids that resolve to contacts the caller can actually see (same
  // org, enforced by RLS) — never trust client-supplied ids blindly.
  let validIds: string[] = []
  if (requestedIds.length > 0) {
    const { data: validContacts, error: vErr } = await supabase
      .from('contacts')
      .select('id')
      .in('id', requestedIds)
    if (vErr) return err(vErr.message, 500)
    validIds = (validContacts ?? []).map(c => c.id)
  }

  // Replace the set: clear the project's team, then insert the validated ids.
  const { error: delErr } = await supabase
    .from('project_team_members')
    .delete()
    .eq('project_id', id)
  if (delErr) return err(delErr.message, 422)

  if (validIds.length > 0) {
    const rows = validIds.map(contact_id => ({ project_id: id, contact_id, added_by: ctx.user.id }))
    const { error: insErr } = await supabase.from('project_team_members').insert(rows)
    if (insErr) return err(insErr.message, 422)
  }

  return ok({ contact_ids: validIds })
}
