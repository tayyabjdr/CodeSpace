import { describe, it, expect } from 'vitest'
import { colsFor, gridShape, cellStyle } from '../src/renderer/grid-layout.js'

describe('grid-layout', () => {
  it('keeps the existing column counts', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(colsFor)).toEqual([1, 2, 3, 2, 3, 3, 4, 4, 4])
  })

  it('lets the last pane take the whole last column when a 2-row grid is one short', () => {
    expect(gridShape(5)).toEqual({ cols: 3, rows: 2, lastSpansColumn: true })
    expect(gridShape(7)).toEqual({ cols: 4, rows: 2, lastSpansColumn: true })
    expect(cellStyle(gridShape(5), 4, 5)).toEqual({ gridColumn: 3, gridRow: '1 / span 2' })
    expect(cellStyle(gridShape(7), 6, 7)).toEqual({ gridColumn: 4, gridRow: '1 / span 2' })
  })

  it('places every other pane automatically', () => {
    for (let i = 0; i < 4; i++) expect(cellStyle(gridShape(5), i, 5)).toBeUndefined()
  })

  it('leaves full grids and single-row grids alone', () => {
    for (const n of [1, 2, 3, 4, 6, 8]) {
      expect(gridShape(n).lastSpansColumn).toBe(false)
      expect(cellStyle(gridShape(n), n - 1, n)).toBeUndefined()
    }
  })

  it('does not span in a 3-row grid', () => {
    expect(gridShape(9)).toEqual({ cols: 4, rows: 3, lastSpansColumn: false })
  })
})
