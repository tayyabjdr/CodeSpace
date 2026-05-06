import { describe, it, expect } from 'vitest'
import { defaultEditorState, clampWidth, mergeEditor, EDITOR_MIN_PX, EDITOR_MAX_FRAC } from '../src/renderer/editor-state.js'

describe('defaultEditorState', () => {
  it('returns a fresh object with expected defaults', () => {
    expect(defaultEditorState()).toEqual({
      open: false, file: null, line: null,
      width: 0, dirty: false, scroll: 0
    })
  })
})

describe('clampWidth', () => {
  it('clamps to minimum', () => {
    expect(clampWidth(100, 1200)).toBe(EDITOR_MIN_PX)
  })
  it('clamps to fractional max', () => {
    expect(clampWidth(2000, 1000)).toBe(Math.floor(1000 * EDITOR_MAX_FRAC))
  })
  it('returns the input when in range', () => {
    expect(clampWidth(500, 2000)).toBe(500)
  })
  it('handles non-numeric input by returning min', () => {
    expect(clampWidth(undefined, 1200)).toBe(EDITOR_MIN_PX)
    expect(clampWidth(NaN, 1200)).toBe(EDITOR_MIN_PX)
  })
})

describe('mergeEditor', () => {
  it('shallow-merges patches into the existing editor state', () => {
    const cur = defaultEditorState()
    const next = mergeEditor(cur, { open: true, file: 'C:\\a.ts' })
    expect(next).toMatchObject({ open: true, file: 'C:\\a.ts', line: null })
    expect(next).not.toBe(cur)
  })

  it('treats undefined-valued patch keys as no-op', () => {
    const cur = { ...defaultEditorState(), open: true }
    const next = mergeEditor(cur, { open: undefined, file: 'x' })
    expect(next.open).toBe(true)
    expect(next.file).toBe('x')
  })
})
