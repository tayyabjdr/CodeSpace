import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SkillsPanel from '../../src/renderer/components/SkillsPanel.jsx'

const SKILLS = [
  { name: 'refactor', description: 'Clean up code', filePath: '/u/.claude/skills/refactor.md' },
  { name: 'review',   description: 'Find bugs',    filePath: '/u/.claude/skills/review.md' },
  { name: 'tests',    description: null,           filePath: '/u/.claude/skills/tests.md' },
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
    render(<SkillsPanel {...baseProps} sourcePath="~/.claude/skills/" />)
    expect(screen.getByText(/~\/\.claude\/skills\//)).toBeTruthy()
    expect(screen.getByText(/3 skills/i)).toBeTruthy()
  })

  it('sets the skill body and name on the drag payload', () => {
    const skill = { name: 'refactor', description: 'x', filePath: '/x/refactor.md', body: 'Clean up this code' }
    render(<SkillsPanel {...baseProps} skills={[skill]} />)
    const card = screen.getByTestId('skill-card')
    const data = new Map()
    const dataTransfer = {
      setData: (type, val) => data.set(type, val),
      effectAllowed: '',
    }
    fireEvent.dragStart(card, { dataTransfer })
    expect(data.get('application/x-codespace-skill')).toBe('Clean up this code')
    expect(data.get('application/x-codespace-skill-name')).toBe('refactor')
  })

  it('switches to the create form when + new is clicked', async () => {
    render(<SkillsPanel {...baseProps} />)
    await userEvent.click(screen.getByRole('button', { name: /\+ new/i }))
    expect(screen.getByLabelText(/skill name/i)).toBeTruthy()
    expect(screen.getByLabelText(/prompt/i)).toBeTruthy()
  })

  it('calls onCreate with {name, body} when the form is submitted', async () => {
    const onCreate = vi.fn().mockResolvedValue({ ok: true })
    render(<SkillsPanel {...baseProps} onCreate={onCreate} />)
    await userEvent.click(screen.getByRole('button', { name: /\+ new/i }))
    await userEvent.type(screen.getByLabelText(/skill name/i), 'audit')
    await userEvent.type(screen.getByLabelText(/prompt/i), 'Audit branch readiness')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'audit', body: 'Audit branch readiness' })
  })

  it('returns to the list when Cancel is clicked', async () => {
    render(<SkillsPanel {...baseProps} />)
    await userEvent.click(screen.getByRole('button', { name: /\+ new/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByLabelText(/skill name/i)).toBeNull()
    expect(screen.getAllByTestId('skill-name').length).toBeGreaterThan(0)
  })

  it('shows an error message when onCreate resolves with { ok: false, reason: "exists" }', async () => {
    const onCreate = vi.fn().mockResolvedValue({ ok: false, reason: 'exists' })
    render(<SkillsPanel {...baseProps} onCreate={onCreate} />)
    await userEvent.click(screen.getByRole('button', { name: /\+ new/i }))
    await userEvent.type(screen.getByLabelText(/skill name/i), 'refactor')
    await userEvent.type(screen.getByLabelText(/prompt/i), 'x')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/already exists/i)).toBeTruthy()
  })
})
