import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api/auth'
import { ok, err } from '@/lib/api/response'

export async function GET(_: NextRequest, { params }: { params: Promise<{ unit_id: string }> }) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)

  const { unit_id } = await params
  const supabase = await createClient()

  const { data: unit, error } = await supabase
    .from('units')
    .select('id, unit_code, unit_type, urgency, status, progress_pct, spk_template_id, spk_templates(stages)')
    .eq('id', unit_id)
    .single()

  if (error || !unit) return err('Unit not found', 404)

  const template = (unit as Record<string, unknown>).spk_templates as Record<string, unknown> | null
  const stages = (template?.stages ?? []) as unknown[]

  return ok({
    ...(unit as Record<string, unknown>),
    spk_stages: stages,
  })
}
