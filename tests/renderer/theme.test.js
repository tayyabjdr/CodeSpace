import { describe, it, expect, beforeEach } from 'vitest'
import { applyTheme, THEME_IDS, DEFAULT_THEME } from '../../src/renderer/theme.js'

beforeEach(() => {
  delete document.documentElement.dataset.theme
})

describe('theme', () => {
  it('exposes the two theme IDs', () => {
    expect(THEME_IDS).toEqual(['sarvis-dark', 'bridge'])
    expect(DEFAULT_THEME).toBe('sarvis-dark')
  })

  it('sets data-theme to bridge', () => {
    applyTheme('bridge')
    expect(document.documentElement.dataset.theme).toBe('bridge')
  })

  it('sets data-theme to sarvis-dark', () => {
    applyTheme('sarvis-dark')
    expect(document.documentElement.dataset.theme).toBe('sarvis-dark')
  })

  it('falls back to sarvis-dark for an invalid id', () => {
    applyTheme('not-a-theme')
    expect(document.documentElement.dataset.theme).toBe('sarvis-dark')
  })

  it('falls back to sarvis-dark for undefined', () => {
    applyTheme(undefined)
    expect(document.documentElement.dataset.theme).toBe('sarvis-dark')
  })
})
