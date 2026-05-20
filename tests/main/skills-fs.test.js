// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync as fsExistsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listSkills,
  parseFrontmatter,
  readSkillBody,
  createSkill,
  sanitizeSkillName,
} from '../../src/main/skills-fs.js'

let TMP

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'cs-skills-test-'))
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

// Helper: create a skill subdir <TMP>/<name>/ containing SKILL.md with `content`.
function writeSkill(name, content) {
  mkdirSync(join(TMP, name), { recursive: true })
  writeFileSync(join(TMP, name, 'SKILL.md'), content)
}

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

  it('lists subdirectories containing SKILL.md, sorted by name', async () => {
    writeSkill('zebra', 'Z body')
    writeSkill('alpha', 'A body')
    // Plain files at top level are not skills.
    writeFileSync(join(TMP, 'README.txt'), 'not a skill')
    // Subdir without SKILL.md is skipped.
    mkdirSync(join(TMP, 'empty-dir'))
    const r = await listSkills(TMP)
    expect(r.ok).toBe(true)
    expect(r.skills.map(s => s.name)).toEqual(['alpha', 'zebra'])
    expect(r.skills[0].filePath).toBe(join(TMP, 'alpha', 'SKILL.md'))
  })

  it('reads description from frontmatter when present', async () => {
    writeSkill('review', '---\ndescription: Find bugs\n---\nFull body here')
    const r = await listSkills(TMP)
    expect(r.skills[0].description).toBe('Find bugs')
  })

  it('skips subdirectories that do not contain SKILL.md', async () => {
    mkdirSync(join(TMP, 'no-skill-here'))
    writeFileSync(join(TMP, 'no-skill-here', 'README.md'), 'not the SKILL file')
    writeSkill('real', 'body')
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
    writeSkill('x', '---\ndescription: x\n---\nThe full prompt body')
    const r = await readSkillBody(join(TMP, 'x', 'SKILL.md'))
    expect(r.ok).toBe(true)
    expect(r.body).toBe('The full prompt body')
  })

  it('returns error when file is missing', async () => {
    const r = await readSkillBody(join(TMP, 'missing', 'SKILL.md'))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not-found')
  })

  it('returns invalid-path when called with a relative path', async () => {
    const r = await readSkillBody('relative/path.md')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid-path')
  })
})

describe('sanitizeSkillName', () => {
  it('lowercases and replaces whitespace with hyphens', () => {
    expect(sanitizeSkillName(' Hello World ')).toBe('hello-world')
  })
  it('strips disallowed characters', () => {
    expect(sanitizeSkillName('foo/bar:baz*.md')).toBe('foobarbazmd')
  })
  it('returns empty string when no valid characters remain', () => {
    expect(sanitizeSkillName('/// ')).toBe('')
  })
  it('passes through valid kebab-case names', () => {
    expect(sanitizeSkillName('refactor-code_v2')).toBe('refactor-code_v2')
  })
  it('returns empty string for null', () => {
    expect(sanitizeSkillName(null)).toBe('')
  })
  it('returns empty string for undefined', () => {
    expect(sanitizeSkillName(undefined)).toBe('')
  })
})

describe('createSkill', () => {
  it('creates <name>/SKILL.md with frontmatter and the given body', async () => {
    const r = await createSkill('my-skill', 'do the thing', TMP)
    expect(r.ok).toBe(true)
    expect(r.filePath).toBe(join(TMP, 'my-skill', 'SKILL.md'))
    expect(readFileSync(r.filePath, 'utf8')).toBe('---\nname: my-skill\n---\ndo the thing')
  })

  it('refuses an empty sanitized name', async () => {
    const r = await createSkill('///', 'body', TMP)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid-name')
  })

  it('refuses to overwrite an existing skill', async () => {
    mkdirSync(join(TMP, 'dup'))
    writeFileSync(join(TMP, 'dup', 'SKILL.md'), 'old')
    const r = await createSkill('dup', 'new', TMP)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('exists')
    expect(readFileSync(join(TMP, 'dup', 'SKILL.md'), 'utf8')).toBe('old')
  })

  it('creates the skills directory if it does not exist', async () => {
    const sub = join(TMP, 'fresh')
    const r = await createSkill('first', 'body', sub)
    expect(r.ok).toBe(true)
    expect(fsExistsSync(join(sub, 'first', 'SKILL.md'))).toBe(true)
  })

  it('roundtrips: createSkill then listSkills sees the new entry', async () => {
    await createSkill('aud-it', 'Audit branch readiness', TMP)
    const r = await listSkills(TMP)
    expect(r.ok).toBe(true)
    expect(r.skills.map(s => s.name)).toEqual(['aud-it'])
    const body = await readSkillBody(r.skills[0].filePath)
    expect(body.ok).toBe(true)
    expect(body.body).toBe('Audit branch readiness')
  })
})
