import { useState } from 'react'

import type { AuthState } from '@shared/auth'
import { Button } from '@renderer/components/ui/button'
import iconUrl from '../../../../../resources/icon.png'

const SIGN_IN_FAILED = '登录失败，请重试。'

export function LoginView({ initialError }: { initialError?: string }): React.JSX.Element {
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState(initialError)

  const signIn = async (): Promise<void> => {
    setIsSigningIn(true)
    setError(undefined)
    try {
      const state = (await window.bridge.invoke('auth:login')) as AuthState
      if (state.status !== 'authenticated') {
        // Only `unauthenticated` carries a specific error; any other lingering
        // state (e.g. `restoring`) is an anomaly, so fall back to a generic one.
        setError(
          state.status === 'unauthenticated' ? (state.error ?? SIGN_IN_FAILED) : SIGN_IN_FAILED
        )
      }
    } catch {
      setError(SIGN_IN_FAILED)
    } finally {
      setIsSigningIn(false)
    }
  }

  return (
    <main className="relative flex h-screen select-none flex-col bg-background text-foreground">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-(--titlebar-h) [-webkit-app-region:drag]"
      />
      <div className="flex flex-1 items-center justify-center px-6">
        <section className="flex w-full max-w-[320px] flex-col items-center text-center">
          <img src={iconUrl} alt="" className="mb-8 size-24 rounded-[22px]" draggable={false} />
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={isSigningIn}
            onClick={() => void signIn()}
          >
            登录
          </Button>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </section>
      </div>
    </main>
  )
}
