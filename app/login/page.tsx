'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (authError) {
      setError('Email atau kata sandi tidak valid. Silakan coba lagi.')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--bg-base)' }}
    >
      <div className="w-full max-w-[360px]">

        {/* Logo mark */}
        <div className="flex items-center gap-3 mb-8">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center font-extrabold text-white text-base flex-shrink-0"
            style={{
              background: 'var(--accent)',
              boxShadow: '0 0 24px var(--accent-glow)',
            }}
          >
            P
          </div>
          <div>
            <div
              className="font-bold text-[17px] leading-tight tracking-tight"
              style={{ color: 'var(--t1)' }}
            >
              Pantau
            </div>
            <div className="text-[11px]" style={{ color: 'var(--t3)' }}>
              Platform Manajemen Konstruksi
            </div>
          </div>
        </div>

        {/* Card */}
        <div
          className="rounded-xl p-6"
          style={{
            background: 'var(--bg-1)',
            border: '1px solid var(--border)',
          }}
        >
          <h1
            className="text-xl font-semibold mb-1"
            style={{ color: 'var(--t1)' }}
          >
            Masuk
          </h1>
          <p className="text-[13px] mb-6" style={{ color: 'var(--t3)' }}>
            Masukkan email dan kata sandi Anda
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--t2)' }}
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@perusahaan.com"
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-all"
                style={{
                  background: 'var(--bg-2)',
                  border: '1px solid var(--border-md)',
                  color: 'var(--t1)',
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.borderColor = 'var(--accent)')
                }
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor = 'var(--border-md)')
                }
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--t2)' }}
              >
                Kata Sandi
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-all"
                style={{
                  background: 'var(--bg-2)',
                  border: '1px solid var(--border-md)',
                  color: 'var(--t1)',
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.borderColor = 'var(--accent)')
                }
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor = 'var(--border-md)')
                }
              />
            </div>

            {/* Error message */}
            {error && (
              <div
                className="px-3 py-2.5 rounded-lg text-[13px]"
                style={{
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  color: 'var(--red)',
                }}
              >
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-50"
              style={{
                background: 'var(--accent)',
                boxShadow: '0 0 20px var(--accent-glow)',
              }}
            >
              {loading ? 'Memproses...' : 'Masuk'}
            </button>
          </form>
        </div>

        {/* Footer note */}
        <p
          className="text-center text-[11px] mt-4"
          style={{ color: 'var(--t3)' }}
        >
          Butuh akses? Hubungi administrator proyek Anda.
        </p>
      </div>
    </div>
  )
}
