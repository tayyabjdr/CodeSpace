// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSkills, parseFrontmatter, readSkillBody } from '../../src/main/skills-fs.js'

let TMP

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'cs-skills-test-'))
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('parseFrontmatter', () => {
  it('returns the first line as description when there is no frontmatter', () => {
    const r = parseFrontmatter('Just a body\nsecond line')
    expect(r.description).toBe('Just a body')
    expect(r.body).toBe('Just a body\nsecond line')
  })

  it('extracts description and strips frontmatter from body', () => {
    const src = '---\ndescription: Refactor selected code\n---\nClean up this code'
    const r = parseFrontmatter(src)
    expect(r.description).toBe('Refactor selected code')
    expect(r.body).toBe('Clean up this code')
  })

  it('uses the first non-empty body line as description when no frontmatter', () => {
    const r = parseFrontmatter('\n\nFirst real line\nsecond')
    expect(r.description).toBe('First real line')
    expect(r.body).toBe('\n\nFirst real line\nsecond')
  })

  it('returns null description when no non-empty line exists', () => {
    const r = parseFrontmatter('\n\n   \n')
    expect(r.description).toBe(null)
    expect(r.body).toBe('\n\n   \n')
  })
})

describe('listSkills', () => {
  it('returns empty array when directory does not exist', async () => {
    const r = await listSkills(join(TMP, 'nope'))
    expect(r.ok).toBe(true)
    expect(r.skills).toEqual([])
  })

  it('lists .md files sorted by name', async () => {
    writeFileSync(join(TMP, 'zebra.md'), 'Z body')
    writeFileSync(join(TMP, 'alpha.md'), 'A body')
    writeFileSync(join(TMP, 'README.txt'), 'not a skill')
    const r = await listSkills(TMP)
    expect(r.ok).toBe(true)
    expect(r.skills.map(s => s.name)).toEqual(['alpha', 'zebra'])
    expect(r.skills[0].filePath).toBe(join(TMP, 'alpha.md'))
  })

  it('reads description from frontmatter when present', async () => {
    writeFileSync(join(TMP, 'review.md'), '---\ndescription: Find bugs\n---\nFull body here')
    const r = await listSkills(TMP)
    expect(r.skills[0].description).toBe('Find bugs')
  })

  it('skips entries that are not regular files (subdirs etc.)', async () => {
    mkdirSync(join(TMP, 'sub.md'))  // a directory named like a md file
    writeFileSync(join(TMP, 'real.md'), 'body')
    const r = await listSkills(TMP)
    expect(r.skills.map(s => s.name)).toEqual(['real'])
  })

  it('returns invalid-dir when called with an empty string', async () => {
    const r = await listSkills('')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid-dir')
    expect(r.skills).toEqual([])
  })
})

describe('readSkillBody', () => {
  it('returns the full file content stripped of frontmatter', async () => {
    const p = join(TMP, 'x.md')
    writeFileSync(p, '---\ndescription: x\n---\nThe full prompt body')
    const r = await readSkillBody(p)
    expect(r.ok).toBe(true)
    expect(r.body).toBe('The full prompt body')
  })

  it('returns error when file is missing', async () => {
    const r = await readSkillBody(join(TMP, 'missing.md'))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not-found')
  })

  it('returns invalid-path when called with a relative path', async () => {
    const r = await readSkillBody('relative/path.md')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid-path')
  })
})

import { createSkill, sanitizeSkillName } from '../../src/main/skills-fs.js'
import { readFileSync, existsSync as fsExistsSync } from 'node:fs'

describe('sanitizeSkillName', () => {
  it('lowercases and replaces whitespace with hyphens', () => {
    expect(sanitizeSkillName(' Hello World ')).toBe('hello-world')
  })
  it('strips disallowed characters', () => {
    expect(sanitizeSkillName('foo/bar:baz*')).toBe('foobarbaz')
  })
  it('returns empty string when no valid characters remain', () => {
    expect(sanitizeSkillName('/// ')).toBe('')
  })
  it('passes through valid kebab-case names', () => {
    expect(sanitizeSkillName('refactor-code_v2')).toBe('refactor-code_v2')
  })
})

describe('createSkill', () => {
  it('writes a new .md file with the given body', async () => {
    const r = await createSkill('my-skill', 'do the thing', TMP)
    expect(r.ok).toBe(true)
    expect(r.filePath).toBe(join(TMP, 'my-skill.md'))
    expect(readFileSync(r.filePath, 'utf8')).toBe('do the thing')
  })

  it('refuses an empty sanitized name', async () => {
    const r = await createSkill('///', 'body', TMP)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid-name')
  })

  it('refuses to overwrite an existing skill', async () => {
    writeFileSync(join(TMP, 'dup.md'), 'old')
    const r = await createSkill('dup', 'new', TMP)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('exists')
    expect(readFileSync(join(TMP, 'dup.md'), 'utf8')).toBe('old')
  })

  it('creates the commands directory if it does not exist', async () => {
    const sub = join(TMP, 'fresh')
    const r = await createSkill('first', 'body', sub)
    expect(r.ok).toBe(true)
    expect(fsExistsSync(join(sub, 'first.md'))).toBe(true)
  })
})
