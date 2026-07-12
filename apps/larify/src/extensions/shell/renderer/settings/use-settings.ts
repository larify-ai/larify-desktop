import { create } from "zustand"

export type SettingsSection = "account" | "general" | "appearance" | "about"

interface SettingsStore {
  section: SettingsSection
  setSection: (section: SettingsSection) => void
}

export const useSettings = create<SettingsStore>((set) => ({
  section: "account",
  setSection: (section) => set({ section }),
}))
