export const THEME_IDS = ['sarvis-dark', 'bridge']
export const DEFAULT_THEME = 'sarvis-dark'

export function applyTheme(id) {
  const safe = THEME_IDS.includes(id) ? id : DEFAULT_THEME
  document.documentElement.dataset.theme = safe
  return safe
}
