import { create } from 'zustand'
import { auth } from '../api/client'

interface User {
  id: string
  username: string
  config: Record<string, string>
}

interface AuthStore {
  user: User | null
  loading: boolean
  setUser: (u: User | null) => void
  fetchMe: () => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  loading: false,

  setUser: (user) => set({ user }),

  fetchMe: async () => {
    set({ loading: true })
    try {
      const user = await auth.me()
      set({
        user: {
          id: user.userId,
          username: user.username,
          config: user.config,
        },
        loading: false,
      })
    } catch {
      set({ user: null, loading: false })
    }
  },

  logout: async () => {
    await auth.logout().catch(() => { })
    set({ user: null })
    window.location.href = '/login'
  },
}))