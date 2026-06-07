import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api/auth'
import { ok, err } from '@/lib/api/response'

export async function GET(_: NextRequest, { params }: { params: Promise<{ unit_id: string }> }) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)

  const { unit_id } = await params
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('units')
    .select('*, submissions(id, stage_number, review_decision, submitted_at, notes, subtasks_checked)')
    .eq('id', unit_id)
    .single()

  if (error || !data) return err('Unit not found', 404)

  const d = data as Record<string, unknown>
  return ok({ ...d, unit_submissions: d.submissions ?? [] })
}
