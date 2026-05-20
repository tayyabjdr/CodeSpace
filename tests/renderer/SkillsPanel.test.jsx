import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SkillsPanel from '../../src/renderer/components/SkillsPanel.jsx'

const SKILLS = [
  { name: 'refactor', description: 'Clean up code', filePath: '/u/.claude/commands/refactor.md' },
  { name: 'review',   description: 'Find bugs',    filePath: '/u/.claude/commands/review.md' },
  { name: 'tests',    description: null,           filePath: '/u/.claude/commands/tests.md' },
]

const baseProps = {
  width: 260,
  loadState: 'content',
  skills: SKILLS,
  onClose: () => {},
  onCreate: () => {},
  onRevealDir: () => {},
}

describe('SkillsPanel', () => {
  it('renders one card per skill in the order they are provided', () => {
    render(<SkillsPanel {...baseProps} />)
    const names = screen.getAllByTestId('skill-name').map(el => el.textContent)
    expect(names).toEqual(['refactor', 'review', 'tests'])
  })

  it('renders description when present', () => {
    render(<SkillsPanel {...baseProps} />)
    expect(screen.getByText('Clean up code')).toBeTruthy()
    expect(screen.getByText('Find bugs')).toBeTruthy()
  })

  it('still renders a card when description is null', () => {
    render(<SkillsPanel {...baseProps} />)
    const cards = screen.getAllByTestId('skill-card')
    expect(cards).toHaveLength(3)
    // The third card ('tests') has no description — its card text only shows the name
    expect(cards[2].textContent).toMatch(/tests/)
  })

  it('filters cards by the filter input value (case-insensitive substring on name or description)', async () => {
    render(<SkillsPanel {...baseProps} />)
    await userEvent.type(screen.getByPlaceholderText(/filter/i), 'rev')
    const names = screen.getAllByTestId('skill-name').map(el => el.textContent)
    expect(names).toEqual(['review'])
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    render(<SkillsPanel {...baseProps} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /close skills/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders a loading shimmer when loadState is "loading"', () => {
    render(<SkillsPanel {...baseProps} loadState="loading" skills={[]} />)
    expect(screen.getByTestId('skills-loading')).toBeTruthy()
  })

  it('renders an empty state when loadState is "content" and skills is empty', () => {
    render(<SkillsPanel {...baseProps} skills={[]} />)
    expect(screen.getByText(/no skills yet/i)).toBeTruthy()
  })

  it('shows the source path and count in the footer', () => {
    render(<SkillsPanel {...baseProps} sourcePath="~/.claude/commands/" />)
    expect(screen.getByText(/~\/\.claude\/commands\//)).toBeTruthy()
    expect(screen.getByText(/3 skills/i)).toBeTruthy()
  })
})
