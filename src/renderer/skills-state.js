export const SKILLS_PANEL_MIN_PX     = 220
export const SKILLS_PANEL_DEFAULT_PX = 260
export const SKILLS_PANEL_MAX_FRAC   = 0.5
const STORAGE_KEY = 'cs-skills-panel-width'

export function clampPanelWidth(px, bodyWidth) {
  const n = Number(px)
  if (!Number.isFinite(n)) return SKILLS_PANEL_DEFAULT_PX
  const max = Math.max(SKILLS_PANEL_MIN_PX, Math.floor(bodyWidth * SKILLS_PANEL_MAX_FRAC))
  if (n < SKILLS_PANEL_MIN_PX) return SKILLS_PANEL_MIN_PX
  if (n > max) return max
  return Math.round(n)
}

export function loadPanelWidth() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    const n = v ? Number(v) : NaN
    return Number.isFinite(n) && n > 0 ? n : SKILLS_PANEL_DEFAULT_PX
  } catch {
    return SKILLS_PANEL_DEFAULT_PX
  }
}

export function savePanelWidth(px) {
  try { window.localStorage.setItem(STORAGE_KEY, String(Math.round(px))) } catch {}
}
