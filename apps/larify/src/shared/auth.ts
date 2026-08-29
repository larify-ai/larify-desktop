export interface AuthUser {
  id: string
  email: string
}

export type AuthState =
  | { status: 'restoring' }
  | { status: 'unauthenticated'; error?: string }
  | { status: 'authenticated'; user: AuthUser }
