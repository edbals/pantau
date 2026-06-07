import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireRole } from '@/lib/api/auth'
import { ok, err } from '@/lib/api/response'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)
  if (!requireRole(ctx, ['koordinator', 'project_manager', 'owner'])) return err('Forbidden', 403)

  const { id } = await params
  const { review_decision, review_reason } = await request.json()

  if (!['approved', 'denied'].includes(review_decision)) {
    return err('review_decision must be approved or denied', 400)
  }
  if (review_decision === 'denied' && !review_reason?.trim()) {
    return err('review_reason is required when denying', 400)
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('submissions')
    .update({
      review_decision,
      review_reason: review_reason?.trim() ?? null,
      reviewed_by: ctx.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return err(error.message, 422)

  // Telegram notification on denial (stub — fires when TELEGRAM_BOT_TOKEN is configured)
  if (review_decision === 'denied' && process.env.TELEGRAM_BOT_TOKEN) {
    sendTelegramDenial(id, review_reason, ctx.profile.full_name).catch(() => {})
  }

  return ok(data)
}

async function sendTelegramDenial(submissionId: string, reason: string, reviewerName: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN!
  // Look up project chat ID and send message
  // Full implementation in Phase 5 when Telegram bot is configured
  console.log('[Telegram] Denial notification stub:', { submissionId, reason, reviewerName })
}
