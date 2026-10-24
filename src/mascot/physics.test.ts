import { describe, expect, it } from 'vitest'
import { Spring, flamePath, mixHex } from './physics'

describe('Spring', () => {
  it('settles on its target', () => {
    const s = new Spring(0)
    s.target = 10
    for (let i = 0; i < 600; i++) s.step(1 / 60)
    expect(s.x).toBeCloseTo(10, 2)
  })
})

describe('mixHex', () => {
  it('blends endpoints and midpoint', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('flamePath', () => {
  it('is a closed path starting at the base', () => {
    const d = flamePath(120, 214, 56, 150, 0, 0, 0)
    expect(d.startsWith('M120.00 214.00')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(d).not.toMatch(/NaN/)
  })
  it('puts the tip at base - height, shifted by sway', () => {
    expect(flamePath(120, 214, 56, 150, 7, 0, 0)).toContain('127.00 64.00')
  })
})
