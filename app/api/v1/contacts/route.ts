import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireRole } from '@/lib/api/auth'
import { ok, created, err } from '@/lib/api/response'
import {
  cleanText, cleanCountryCode, cleanPhone,
  cleanBool, cleanEmail, cleanCustomAttributes,
} from '@/lib/api/contacts-input'

// GET /api/v1/contacts — the org's global team roster (visible to all members).
export async function GET() {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)
  if (!ctx.profile.org_id) return ok([])

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('org_id', ctx.profile.org_id)
    .order('created_at', { ascending: false })

  if (error) return err(error.message, 500)
  return ok(data)
}

// POST /api/v1/contacts — add a contact (owner / project_manager only).
export async function POST(request: NextRequest) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)
  if (!requireRole(ctx, ['owner', 'project_manager'])) return err('Forbidden', 403)
  if (!ctx.profile.org_id) return err('No organisation', 400)

  const body = await request.json().catch(() => null)
  if (!body) return err('Invalid JSON body', 400)

  const name = cleanText(body.name, 120)
  const role = cleanText(body.role, 60)
  const phone = cleanPhone(body.phone)
  if (!name) return err('name is required', 400)
  if (!role) return err('role is required', 400)
  if (!phone) return err('phone is required', 400)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      org_id: ctx.profile.org_id,
      name,
      role,
      email: cleanEmail(body.email),
      has_whatsapp: cleanBool(body.has_whatsapp),
      has_telegram: cleanBool(body.has_telegram),
      country_code: cleanCountryCode(body.country_code),
      phone,
      custom_attributes: cleanCustomAttributes(body.custom_attributes),
      created_by: ctx.user.id,
    })
    .select()
    .single()

  if (error) return err(error.message, 422)
  return created(data)
}
