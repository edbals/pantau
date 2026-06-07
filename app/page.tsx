import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Root route: send authenticated users to dashboard, everyone else to login.
// Middleware handles the same check on every request — this is a safety net.
export default async function RootPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  }
  redirect('/login')
}
