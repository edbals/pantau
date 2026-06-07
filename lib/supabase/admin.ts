import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'

// Bypasses RLS. Only use server-side for privileged operations
// (QR generation, stats aggregation, seeding). Never expose to client.
export function createAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  }
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
