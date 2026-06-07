import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api/auth'
import { ok, err } from '@/lib/api/response'

export async function GET() {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('submissions')
    .select(`
      id, stage_number, subtasks_checked, notes, submitted_at,
      units!inner(id, unit_code, urgency, project_id,
        projects!inner(name, org_id)
      ),
      users!submitted_by(full_name)
    `)
    .is('review_decision', null)
    .order('submitted_at', { ascending: true })

  if (error) return err(error.message, 500)

  const mapped = (data ?? []).map((s: Record<string, unknown>) => {
    const unit = s.units as Record<string, unknown>
    const project = (unit?.projects ?? {}) as Record<string, unknown>
    const user = s.users as Record<string, unknown>
    return {
      id: s.id,
      unit_code: unit?.unit_code,
      urgency: unit?.urgency ?? 'normal',
      project_name: project?.name,
      stage_number: s.stage_number,
      stage_name: `Tahap ${s.stage_number}`,
      pengawas_name: user?.full_name ?? 'Pengawas',
      submitted_at: s.submitted_at,
      subtasks_checked: s.subtasks_checked,
      notes: s.notes,
    }
  })

  return ok(mapped)
}
