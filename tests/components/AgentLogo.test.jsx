import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AgentLogo, { hasAgentLogo } from '../../src/renderer/components/AgentLogo.jsx'

describe('AgentLogo', () => {
  it('draws a labelled mark for claude and codex', () => {
    for (const [shell, name] of [['claude', 'Claude'], ['codex', 'Codex']]) {
      const { container, unmount } = render(<AgentLogo shell={shell} />)
      const svg = container.querySelector('svg')
      expect(svg.getAttribute('aria-label')).toBe(name)
      expect(svg.getAttribute('fill')).toBe('currentColor')
      unmount()
    }
  })

  it('renders nothing for an unknown shell', () => {
    const { container } = render(<AgentLogo shell="gemini" />)
    expect(container.firstChild).toBeNull()
    expect(hasAgentLogo('gemini')).toBe(false)
  })
})
