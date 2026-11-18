import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EmptyWorkspaceSetup from '../../src/renderer/components/EmptyWorkspaceSetup.jsx'

const BOTH = { claude: true, codex: true }
const addButton = () => screen.getByRole('button', { name: /^Add/ })

describe('EmptyWorkspaceSetup', () => {
  it('starts at two Claude agents with the shared steppers', () => {
    render(<EmptyWorkspaceSetup availability={BOTH} onAdd={() => {}} />)
    expect(screen.getByTestId('count-claude').textContent).toBe('2')
    expect(screen.getByTestId('count-codex').textContent).toBe('0')
    expect(addButton().textContent).toBe('Add 2 agents')
  })

  it('+ Codex adds a pane instead of taking one from Claude', async () => {
    const onAdd = vi.fn()
    render(<EmptyWorkspaceSetup availability={BOTH} onAdd={onAdd} />)
    await userEvent.click(screen.getByRole('button', { name: 'One more Codex' }))
    expect(screen.getByTestId('count-claude').textContent).toBe('2')
    expect(screen.getByTestId('count-codex').textContent).toBe('1')
    await userEvent.click(addButton())
    expect(onAdd).toHaveBeenCalledWith({ claude: 2, codex: 1 })
  })

  it('picking a layout keeps the mix inside it', async () => {
    const onAdd = vi.fn()
    render(<EmptyWorkspaceSetup availability={BOTH} onAdd={onAdd} />)
    await userEvent.click(screen.getByRole('button', { name: 'One more Codex' }))
    await userEvent.click(screen.getByRole('radio', { name: '1 agent' }))
    await userEvent.click(addButton())
    expect(onAdd).toHaveBeenCalledWith({ claude: 0, codex: 1 })
  })

  it('runs every pane as the only installed CLI', async () => {
    const onAdd = vi.fn()
    render(<EmptyWorkspaceSetup availability={{ claude: false, codex: true }} onAdd={onAdd} />)
    expect(screen.queryByTestId('count-claude')).toBeNull()
    expect(screen.getByText(/every pane runs Codex/)).toBeTruthy()
    await userEvent.click(addButton())
    expect(onAdd).toHaveBeenCalledWith({ claude: 0, codex: 2 })
  })
})
