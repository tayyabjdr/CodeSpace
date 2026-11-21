import { describe, it, expect } from 'vitest'
import { logicalLineAt, spanToRange, spanCrossesRows } from '../src/renderer/wrapped-line.js'
import { parsePathsInLine } from '../src/renderer/path-parser.js'

const COLS = 40
const rows = (...lines) => (y) => {
  const l = lines[y]
  if (l == null) return null
  return typeof l === 'string' ? { text: l.trimEnd(), isWrapped: false } : l
}

describe('logicalLineAt', () => {
  // A path Claude's TUI hard-broke at the right edge (3 rows, no indent).
  const screen = rows(
    'some prose before',
    'Image: C:/Users/TJ/AppData/Local/Temp/cl',
    'aude/41e8/scratchpad/split_screen_now.pn',
    'g',
    '',
  )

  it('joins hard-wrapped rows that end mid-path', () => {
    for (const y of [1, 2, 3]) {
      const { text, first, last } = logicalLineAt(screen, y, COLS)
      expect(text).toBe('Image: C:/Users/TJ/AppData/Local/Temp/claude/41e8/scratchpad/split_screen_now.png')
      expect([first, last]).toEqual([1, 3])
    }
  })

  it('maps the joined path back to a multi-row range', () => {
    const { text, cells } = logicalLineAt(screen, 2, COLS)
    const [m] = parsePathsInLine(text)
    expect(m.path).toBe('C:/Users/TJ/AppData/Local/Temp/claude/41e8/scratchpad/split_screen_now.png')
    expect(spanCrossesRows(cells, m.start, m.end)).toBe(true)
    expect(spanToRange(cells, m.start, m.end, 2)).toEqual({
      start: { x: 8, y: 2 },
      end: { x: 1, y: 4 },
    })
    expect(spanToRange(cells, m.start, m.end, 0)).toBeNull()
  })

  it('does not join a short row or one ending in a space', () => {
    expect(logicalLineAt(screen, 0, COLS).text).toBe('some prose before')
    const s = rows('C:/a/b.png and then some more words here ', 'next')
    expect(logicalLineAt(s, 0, COLS).text).toBe('C:/a/b.png and then some more words here')
  })

  it('does not join a full row whose last token has no slash', () => {
    const s = rows('this is a long line of plain prose wordss', 'continues')
    expect(logicalLineAt(s, 0, COLS).last).toBe(0)
  })

  it('drops the indent of a hard-wrapped continuation row', () => {
    const s = rows('  see C:/Users/TJ/project/src/components/', '  Sidebar.jsx for details')
    expect(logicalLineAt(s, 1, COLS).text).toBe('  see C:/Users/TJ/project/src/components/Sidebar.jsx for details')
  })

  it('follows xterm soft wraps regardless of content', () => {
    const s = rows({ text: 'abc def', isWrapped: false }, { text: 'ghi', isWrapped: true })
    expect(logicalLineAt(s, 1, COLS).text).toBe('abc defghi')
  })
})
