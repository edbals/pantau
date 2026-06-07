import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api/auth'
import { ok, err } from '@/lib/api/response'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)

  const { id } = await params
  const { canvas_data } = await request.json()

  if (!canvas_data) return err('canvas_data is required', 400)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .update({ canvas_data })
    .eq('id', id)
    .select('id, canvas_data')
    .single()

  if (error) return err(error.message, 422)
  return ok(data)
}
