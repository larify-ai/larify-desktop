import { createContext, useContext } from 'react'

export interface AuthContextValue {
  email: string | null
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside AuthGate')
  return auth
}
