import { createClient } from '@/lib/supabase/server'
import type { User, UserRole } from '@/lib/types/database'

export interface AuthContext {
  user: { id: string; email: string }
  profile: User
}

// Call at the top of every API route handler.
// Returns 401-ready error or the verified user + profile.
export async function requireAuth(): Promise<AuthContext | { error: string; status: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: 'Unauthorized', status: 401 }

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) return { error: 'User profile not found', status: 401 }

  return { user: { id: user.id, email: user.email! }, profile: profile as User }
}

export function requireRole(ctx: AuthContext, roles: UserRole[]): boolean {
  return roles.includes(ctx.profile.role as UserRole)
}
