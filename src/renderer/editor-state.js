export const EDITOR_MIN_PX = 320
export const EDITOR_MAX_FRAC = 0.7
export const EDITOR_DEFAULT_FRAC = 0.45

export function defaultEditorState() {
  return { open: false, file: null, line: null, width: 0, dirty: false, scroll: 0 }
}

export function clampWidth(px, bodyWidth) {
  const n = Number(px)
  if (!Number.isFinite(n)) return EDITOR_MIN_PX
  const max = Math.floor(bodyWidth * EDITOR_MAX_FRAC)
  if (n < EDITOR_MIN_PX) return EDITOR_MIN_PX
  if (n > max) return max
  return Math.round(n)
}

export function mergeEditor(current, patch) {
  const out = { ...current }
  for (const k of Object.keys(patch)) {
    if (patch[k] !== undefined) out[k] = patch[k]
  }
  return out
}
