import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireRole } from '@/lib/api/auth'
import { ok, err } from '@/lib/api/response'

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)

  const { id } = await params
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .select('*, project_members(user_id, role)')
    .eq('id', id)
    .single()

  if (error || !data) return err('Project not found', 404)
  return ok(data)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)

  const { id } = await params
  const body = await request.json()

  const allowed = ['name', 'status', 'canvas_data', 'site_plan_image_url', 'go_live_at']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return err(error.message, 422)
  return ok(data)
}
