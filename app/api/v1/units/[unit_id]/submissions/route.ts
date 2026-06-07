import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireRole } from '@/lib/api/auth'
import { ok, created, err } from '@/lib/api/response'

export async function GET(_: NextRequest, { params }: { params: Promise<{ unit_id: string }> }) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)

  const { unit_id } = await params
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('submissions')
    .select('*, users!submitted_by(full_name), users!reviewed_by(full_name), submission_photos(*)')
    .eq('unit_id', unit_id)
    .order('submitted_at', { ascending: false })

  if (error) return err(error.message, 500)
  return ok(data)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ unit_id: string }> }) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)
  if (!requireRole(ctx, ['pengawas', 'project_manager', 'owner'])) return err('Forbidden', 403)

  const { unit_id } = await params
  const { stage_number, subtasks_checked, notes } = await request.json()

  if (!stage_number || !Array.isArray(subtasks_checked)) {
    return err('stage_number and subtasks_checked are required', 400)
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('submissions')
    .insert({
      unit_id,
      stage_number,
      submitted_by: ctx.user.id,
      subtasks_checked,
      notes: notes?.trim() ?? null,
    })
    .select()
    .single()

  if (error) return err(error.message, 422)

  // Update unit status to pending_review
  await supabase
    .from('units')
    .update({ status: 'pending_review' })
    .eq('id', unit_id)

  return created(data)
}
