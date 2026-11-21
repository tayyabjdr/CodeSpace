// Stitches a terminal row back together with the rows it wraps into, so a
// path or URL broken across lines can still be found and Ctrl+clicked.
//
// Two kinds of wrap show up in a pane:
//   - xterm's own soft wrap: the next row's `isWrapped` is set.
//   - Claude CLI's wrap: its TUI breaks long text into separate rows itself,
//     so xterm sees ordinary hard newlines. A long path with no spaces gets
//     cut mid-token at the right edge. That case is guessed: the row runs to
//     (nearly) the full width, ends mid-token, and that token looks like a
//     path or URL (contains a slash). The next row's indent is dropped.
//
// `getRow(y)` returns `{ text, isWrapped }` for 0-based buffer row y, or null
// past the ends; `text` is the row with trailing whitespace trimmed.
// Returns the joined text and, for each character, the {x, y} cell it came
// from (both 0-based).

const MAX_ROWS = 8
// Claude's TUI keeps a small right margin, so "full" is a little short of cols.
const HARD_WRAP_SLACK = 10

function continuesInto(row, next, cols) {
  if (!row || !next) return false
  if (next.isWrapped) return true
  if (row.text.length < cols - HARD_WRAP_SLACK) return false
  if (/\s$/.test(row.text) || row.text.length === 0) return false
  if (next.text.trim().length === 0) return false
  const lastToken = row.text.match(/\S+$/)?.[0] ?? ''
  return /[\\/]/.test(lastToken)
}

export function logicalLineAt(getRow, y, cols) {
  let first = y
  while (y - first < MAX_ROWS && continuesInto(getRow(first - 1), getRow(first), cols)) first--
  let last = y
  while (last - y < MAX_ROWS && continuesInto(getRow(last), getRow(last + 1), cols)) last++

  let text = ''
  const cells = []
  for (let r = first; r <= last; r++) {
    const row = getRow(r)
    if (!row) break
    // Hard-wrapped continuation rows carry the TUI's indent; soft-wrapped
    // rows are a straight continuation of the cells above.
    const skip = r > first && !row.isWrapped ? row.text.length - row.text.trimStart().length : 0
    for (let x = skip; x < row.text.length; x++) {
      text += row.text[x]
      cells.push({ x, y: r })
    }
  }
  return { text, cells, first, last }
}

// Turns a [start, end) character span of a logical line into an xterm link
// range (1-based, end inclusive). Returns null if the span doesn't touch row y.
export function spanToRange(cells, start, end, y) {
  if (end <= start || !cells[start] || !cells[end - 1]) return null
  const a = cells[start], b = cells[end - 1]
  if (b.y < y || a.y > y) return null
  return {
    start: { x: a.x + 1, y: a.y + 1 },
    end:   { x: b.x + 1, y: b.y + 1 },
  }
}

// True when the span runs across more than one buffer row.
export function spanCrossesRows(cells, start, end) {
  return !!cells[start] && !!cells[end - 1] && cells[start].y !== cells[end - 1].y
}
