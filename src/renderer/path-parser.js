// Pure pattern-list matcher returning {start, end, raw, path, line, col}
// per match. Order is meaningful — more-specific patterns first; later
// patterns won't claim ranges already claimed by earlier ones.
//
// `start` and `end` are indices into the original text such that
// text.slice(start, end) === path (when no trailing punctuation is stripped).
// When trailing punctuation is stripped, `end` equals start + path.length
// (exclusive end of the clean path, NOT including stripped chars).

const TRAIL_PUNCT_RE = /[.,;:)\]>]+$/

// Windows absolute path whose folder names may contain spaces
// ("D:\PC Backup\x.md", "C:\Program Files\…"). A spaced run only counts when a
// separator follows it, and a word ending in a file extension can't sit inside
// one, so "C:\a.ts and see b\c.md" stays two paths. File names stay
// space-free. Spaces make this a guess, so callers should check the file
// exists and fall back to `{ folderSpaces: false }` when it doesn't.
const WIN_ABS_SPACED = {
  name: 'win-abs',
  re: /\b[A-Za-z]:[\\/](?:[^\s:"<>|?*\\/]+(?:(?<!\.[A-Za-z0-9]{1,8}) +[^\s:"<>|?*\\/]+)*[\\/])*[^\s:"<>|?*\\/]+\.[A-Za-z0-9]{1,8}(?![A-Za-z0-9])(?::\d+)?(?::\d+)?/g,
}

const PATTERNS = [
  {
    name: 'win-abs',
    // Drive letter, separator, then path ending in a known extension (no following alphanum).
    re: /\b[A-Za-z]:[\\/][^\s:"<>|?*]+\.[A-Za-z0-9]{1,8}(?![A-Za-z0-9])(?::\d+)?(?::\d+)?/g,
  },
  {
    name: 'posix-abs',
    re: /(?:(?<=^)|(?<=\s))\/[^\s:"<>|?*]+\.[A-Za-z0-9]{1,8}(?![A-Za-z0-9])(?::\d+)?(?::\d+)?/g,
  },
  {
    name: 'relative',
    re: /(?:(?<=^)|(?<=\s)|(?<=")|(?<=\()|(?<=\[))(?:\.\.?[\\/])?[\w@\-./\\]+\.[A-Za-z0-9]{1,8}(?![A-Za-z0-9])(?::\d+)?(?::\d+)?/g,
  },
]

const SUFFIX_RE = /:(\d+)(?::(\d+))?$/

export function parsePathsInLine(text, { folderSpaces = true } = {}) {
  if (typeof text !== 'string' || text.length === 0) return []
  const out = []
  const claimed = new Array(text.length).fill(false)
  const patterns = folderSpaces ? [WIN_ABS_SPACED, ...PATTERNS] : PATTERNS

  for (const { re } of patterns) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      let raw = m[0]
      let start = m.index

      // Strip trailing punctuation AFTER suffix detection so we don't
      // accidentally eat a colon that is part of a valid :line suffix.
      // Order: strip suffix → strip body trailing-punct → rejoin.

      // Step 1: detect and extract suffix from the raw match
      const sfxMatch = raw.match(SUFFIX_RE)
      const suffix = sfxMatch ? sfxMatch[0] : ''
      const rawBody = sfxMatch ? raw.slice(0, raw.length - suffix.length) : raw

      // Step 2: strip trailing punctuation from the body only
      const trailMatch = rawBody.match(TRAIL_PUNCT_RE)
      const cleanBody = trailMatch
        ? rawBody.slice(0, rawBody.length - trailMatch[0].length)
        : rawBody

      raw = cleanBody + suffix
      // end is exclusive end of the clean path in the original text
      const end = start + cleanBody.length + suffix.length

      if (claimed[start] || (end > 0 && claimed[end - 1])) continue

      // Extract path and line/col from the cleaned raw string
      let path = raw
      let line = null
      let col = null
      const sfx = raw.match(SUFFIX_RE)
      if (sfx) {
        path = raw.slice(0, raw.length - sfx[0].length)
        line = Number(sfx[1])
        col = sfx[2] != null ? Number(sfx[2]) : null
      }

      // Must end in a valid 1-8 char extension with no trailing alphanums
      if (!/\.[A-Za-z0-9]{1,8}$/.test(path)) continue

      // Must not look like a version string (e.g. v1.2.3) or a flag
      if (/^v\d/.test(path)) continue
      if (/^-/.test(path)) continue
      // Reject bare numeric-dotted patterns like "1.2.3"
      if (/^\d+\.\d+/.test(path)) continue

      for (let i = start; i < end; i++) claimed[i] = true
      out.push({ start, end, raw, path, line, col })
    }
  }

  out.sort((a, b) => a.start - b.start)
  return out
}
