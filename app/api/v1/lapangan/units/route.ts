import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api/auth'
import { ok, err } from '@/lib/api/response'

export async function GET() {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('unit_assignments')
    .select(`
      unit_id,
      units!inner(unit_code, unit_type, urgency, status, progress_pct,
        projects!inner(id, name)
      )
    `)
    .eq('user_id', ctx.user.id)

  if (error) return err(error.message, 500)

  const mapped = (data ?? []).map((a: Record<string, unknown>) => {
    const unit = a.units as Record<string, unknown>
    const project = (unit?.projects ?? {}) as Record<string, unknown>
    return {
      unit_id: a.unit_id,
      unit_code: unit?.unit_code,
      unit_type: unit?.unit_type,
      urgency: unit?.urgency,
      status: unit?.status,
      progress_pct: unit?.progress_pct ?? 0,
      project_id: project?.id,
      project_name: project?.name,
    }
  })

  return ok(mapped)
}
