import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireRole } from '@/lib/api/auth'
import { ok, created, err } from '@/lib/api/response'

export async function GET() {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('spk_templates')
    .select('id, name, level, total_stages, total_subtasks, applicable_unit_types, is_archived')
    .eq('is_archived', false)
    .order('created_at', { ascending: false })

  if (error) return err(error.message, 500)
  return ok(data)
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)
  if (!requireRole(ctx, ['owner', 'project_manager'])) return err('Forbidden', 403)

  const body = await request.json()
  const { name, stages, total_stages, total_subtasks, applicable_unit_types } = body

  if (!name || !stages) return err('name and stages are required', 400)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('spk_templates')
    .insert({
      name: String(name).trim(),
      level: 'org',
      org_id: ctx.profile.org_id!,
      applicable_unit_types: applicable_unit_types ?? ['house'],
      stages,
      total_stages: total_stages ?? stages.length,
      total_subtasks: total_subtasks ?? 0,
    })
    .select()
    .single()

  if (error) return err(error.message, 422)
  return created(data)
}
