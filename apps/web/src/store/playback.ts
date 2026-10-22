import { create } from 'zustand'
// Written only by the HTMLAudioElement clock, never by an independent timer.
export const usePlaybackStore = create<{ currentTimeMs: number; setTime: (ms: number) => void }>(set => ({
  currentTimeMs: -1, setTime: currentTimeMs => set({ currentTimeMs }),
}))
