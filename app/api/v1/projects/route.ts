import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireRole } from '@/lib/api/auth'
import { ok, created, err } from '@/lib/api/response'

export async function GET() {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, project_code, project_type, status, go_live_at, created_at')
    .eq('org_id', ctx.profile.org_id!)
    .order('created_at', { ascending: false })

  if (error) return err(error.message, 500)
  return ok(data)
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)
  if (!requireRole(ctx, ['owner'])) return err('Forbidden', 403)

  const body = await request.json()
  const { name, project_code, project_type } = body

  if (!name || !project_code || !project_type) {
    return err('name, project_code, and project_type are required', 400)
  }

  const code = String(project_code).replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase()

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .insert({
      org_id: ctx.profile.org_id!,
      name: String(name).trim(),
      project_code: code,
      project_type,
      status: 'setup',
    })
    .select()
    .single()

  if (error) return err(error.message, 422)
  return created(data)
}
