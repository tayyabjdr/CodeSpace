// Display helpers for folder paths on the setup screen.

const SEP = /[\\/]+/

export function basename(p) {
  return String(p ?? '').split(SEP).filter(Boolean).pop() || String(p ?? '')
}

// The folder a path lives in, shortened from the middle so both ends stay
// readable: "D:\PC Backup\ControlDeck\Hub" → "D:\PC Backup\ControlDeck",
// and a deep one keeps the drive plus the closest folders: "C:\…\Clients\Acme".
// Ending-truncation ("D:\PC Backup\Con…") hides exactly the part that differs.
export function parentLabel(p, max = 30) {
  const parts = String(p ?? '').split(SEP).filter(Boolean)
  if (parts.length <= 1) return ''
  const parent = parts.slice(0, -1)
  const full = parent.join('\\')
  if (full.length <= max || parent.length <= 2) return full
  const head = parent[0]
  const tail = []
  for (let i = parent.length - 1; i > 0; i--) {
    const next = [parent[i], ...tail]
    if (tail.length && `${head}\\…\\${next.join('\\')}`.length > max) break
    tail.unshift(parent[i])
  }
  return tail.length === parent.length - 1 ? full : `${head}\\…\\${tail.join('\\')}`
}
