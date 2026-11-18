// Terminal grid shape, shared by the live grid (App.jsx) and the agent-count
// previews (Onboarding, EmptyWorkspaceSetup) so they always agree.
// 1→1 · 2→2 · 3→3 · 4→2×2 · 5–6→3×2 · 7+→4 columns (max)

export function colsFor(n) {
  if (n <= 1) return 1
  if (n === 2) return 2
  if (n === 3) return 3
  if (n === 4) return 2
  if (n <= 6) return 3
  return 4
}

// A two-row grid one pane short (5 in 3×2, 7 in 4×2) would leave a hole in
// the bottom-right corner. Instead the last pane takes the whole last column,
// top to bottom, and the others fill the columns before it row by row:
// 5 → 1 2 / 3 4 / 5 on the right.
export function gridShape(n) {
  const cols = colsFor(n)
  const rows = Math.max(1, Math.ceil(n / cols))
  const lastSpansColumn = rows === 2 && cols * rows - n === 1
  return { cols, rows, lastSpansColumn }
}

// Inline style for the pane at `index`. Only the last pane is ever placed by
// hand; CSS grid auto-places the rest around it.
export function cellStyle(shape, index, n) {
  if (!shape.lastSpansColumn || index !== n - 1) return undefined
  return { gridColumn: shape.cols, gridRow: '1 / span 2' }
}
