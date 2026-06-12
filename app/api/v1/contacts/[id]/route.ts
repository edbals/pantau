import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireRole } from '@/lib/api/auth'
import { ok, err } from '@/lib/api/response'
import {
  cleanText, cleanCountryCode, cleanPhone,
  cleanBool, cleanEmail, cleanCustomAttributes,
} from '@/lib/api/contacts-input'

// PATCH /api/v1/contacts/:id — edit a roster contact (owner / project_manager).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)
  if (!requireRole(ctx, ['owner', 'project_manager'])) return err('Forbidden', 403)
  if (!ctx.profile.org_id) return err('No organisation', 400)

  const { id } = await params
  const body = await request.json().catch(() => null)
  if (!body) return err('Invalid JSON body', 400)

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) {
    const name = cleanText(body.name, 120)
    if (!name) return err('name cannot be empty', 400)
    patch.name = name
  }
  if (body.role !== undefined) {
    const role = cleanText(body.role, 60)
    if (!role) return err('role cannot be empty', 400)
    patch.role = role
  }
  if (body.email !== undefined) patch.email = cleanEmail(body.email)
  if (body.has_whatsapp !== undefined) patch.has_whatsapp = cleanBool(body.has_whatsapp)
  if (body.has_telegram !== undefined) patch.has_telegram = cleanBool(body.has_telegram)
  if (body.country_code !== undefined) patch.country_code = cleanCountryCode(body.country_code)
  if (body.phone !== undefined) {
    const phone = cleanPhone(body.phone)
    if (!phone) return err('phone cannot be empty', 400)
    patch.phone = phone
  }
  if (body.custom_attributes !== undefined) patch.custom_attributes = cleanCustomAttributes(body.custom_attributes)
  if (Object.keys(patch).length === 0) return err('No fields to update', 400)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .update(patch)
    .eq('id', id)
    .eq('org_id', ctx.profile.org_id)
    .select()
    .single()

  if (error) return err(error.message, 422)
  if (!data) return err('Contact not found', 404)
  return ok(data)
}

// DELETE /api/v1/contacts/:id — remove a roster contact (owner / project_manager).
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)
  if (!requireRole(ctx, ['owner', 'project_manager'])) return err('Forbidden', 403)
  if (!ctx.profile.org_id) return err('No organisation', 400)

  const { id } = await params
  const supabase = await createClient()
  const { error } = await supabase
    .from('contacts')
    .delete()
    .eq('id', id)
    .eq('org_id', ctx.profile.org_id)

  if (error) return err(error.message, 422)
  return ok({ id })
}
