'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SignOutButton() {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleSignOut}
      className="text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors"
      style={{
        background: 'var(--bg-3)',
        color: 'var(--t2)',
        border: '1px solid var(--border-md)',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.color = 'var(--t1)'
        e.currentTarget.style.borderColor = 'var(--border-lg)'
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.color = 'var(--t2)'
        e.currentTarget.style.borderColor = 'var(--border-md)'
      }}
    >
      Keluar
    </button>
  )
}
