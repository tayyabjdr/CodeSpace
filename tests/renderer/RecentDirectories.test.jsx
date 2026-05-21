import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RecentDirectories from '../../src/renderer/components/RecentDirectories.jsx'

const RECENTS = ['D:\\Projects\\CodeSpace', 'C:\\Users\\TJ\\Desktop\\Socials']

describe('RecentDirectories', () => {
  it('renders nothing when the list is empty', () => {
    const { container } = render(
      <RecentDirectories recents={[]} currentDir="" onPick={() => {}} onRemove={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when recents is undefined', () => {
    const { container } = render(
      <RecentDirectories recents={undefined} currentDir="" onPick={() => {}} onRemove={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders a card per recent directory showing its basename', () => {
    render(
      <RecentDirectories recents={RECENTS} currentDir="" onPick={() => {}} onRemove={() => {}} />
    )
    expect(screen.getByText('CodeSpace')).toBeTruthy()
    expect(screen.getByText('Socials')).toBeTruthy()
  })

  it('fires onPick with the directory when a card is clicked', async () => {
    const onPick = vi.fn()
    render(
      <RecentDirectories recents={RECENTS} currentDir="" onPick={onPick} onRemove={() => {}} />
    )
    await userEvent.click(screen.getByText('CodeSpace'))
    expect(onPick).toHaveBeenCalledWith('D:\\Projects\\CodeSpace')
  })

  it('fires onRemove (and not onPick) when the remove button is clicked', async () => {
    const onPick = vi.fn()
    const onRemove = vi.fn()
    render(
      <RecentDirectories recents={RECENTS} currentDir="" onPick={onPick} onRemove={onRemove} />
    )
    await userEvent.click(screen.getByRole('button', { name: /remove codespace/i }))
    expect(onRemove).toHaveBeenCalledWith('D:\\Projects\\CodeSpace')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('marks the card matching currentDir as active (case-insensitive)', () => {
    render(
      <RecentDirectories
        recents={RECENTS}
        currentDir={'d:\\projects\\codespace\\'}
        onPick={() => {}}
        onRemove={() => {}}
      />
    )
    const card = screen.getByText('CodeSpace').closest('.ob-recent-card')
    expect(card.classList.contains('active')).toBe(true)
  })
})
