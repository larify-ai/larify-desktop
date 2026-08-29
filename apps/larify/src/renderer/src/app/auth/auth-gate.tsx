import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AuthState } from '@shared/auth'
import { Spinner } from '@renderer/components/ui/spinner'
import { AuthContext } from './auth-context'
import { LoginView } from './login-view'

interface AuthGateProps {
  children: React.ReactNode
}

export function AuthGate({ children }: AuthGateProps): React.JSX.Element {
  const [state, setState] = useState<AuthState>({ status: 'restoring' })
  useEffect(() => {
    let active = true
    let receivedEvent = false
    const unsubscribe = window.bridge.on('auth:changed', (nextState) => {
      if (!active) return
      receivedEvent = true
      setState(nextState as AuthState)
    })
    void window.bridge
      .invoke('auth:state')
      .then((nextState) => {
        // The initial snapshot must not overwrite a fresher broadcast received first.
        if (active && !receivedEvent) setState(nextState as AuthState)
      })
      .catch(() => undefined)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  const logout = useCallback(async (): Promise<void> => {
    await window.bridge.invoke('auth:logout')
  }, [])
  const auth = useMemo(
    () => ({ email: state.status === 'authenticated' ? state.user.email : null, logout }),
    [logout, state]
  )

  if (state.status === 'restoring') {
    return (
      <main
        className="flex h-screen items-center justify-center bg-background"
        aria-label="正在恢复登录"
      >
        <Spinner className="size-5" />
      </main>
    )
  }

  return (
    <AuthContext.Provider value={auth}>
      {state.status === 'authenticated' ? children : <LoginView initialError={state.error} />}
    </AuthContext.Provider>
  )
}
