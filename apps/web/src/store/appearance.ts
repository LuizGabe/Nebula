import { create } from 'zustand'
export type Theme = 'dark' | 'light'
function stored(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function persist(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* Preferences remain usable without storage. */ } }
export const useAppearanceStore = create<{
  theme: Theme; collapsed: boolean; toggleTheme: () => void; toggleSidebar: () => void
}>(set => ({
  theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  collapsed: stored('nebula:sidebar-collapsed') === 'true',
  toggleTheme: () => set(state => {
    const theme = state.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    document.documentElement.style.background = theme === 'light' ? '#f6f7f9' : '#111214'
    persist('nebula:theme', theme)
    return { theme }
  }),
  toggleSidebar: () => set(state => {
    const collapsed = !state.collapsed
    persist('nebula:sidebar-collapsed', String(collapsed))
    return { collapsed }
  }),
}))
window.addEventListener('storage', event => {
  if (event.key === 'nebula:theme') {
    const theme = event.newValue === 'light' ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    document.documentElement.style.background = theme === 'light' ? '#f6f7f9' : '#111214'
    useAppearanceStore.setState({ theme })
  }
  if (event.key === 'nebula:sidebar-collapsed') useAppearanceStore.setState({ collapsed: event.newValue === 'true' })
})
