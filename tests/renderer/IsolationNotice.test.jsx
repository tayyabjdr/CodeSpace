import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IsolationNotice from '../../src/renderer/components/IsolationNotice.jsx'

describe('IsolationNotice', () => {
  it('renders nothing without a kind', () => {
    const { container } = render(<IsolationNotice kind={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('spawn-failed shows the count, detail and a Retry that calls onRetry; no dismiss', async () => {
    const onRetry = vi.fn()
    render(<IsolationNotice kind="spawn-failed" actionEnabled failures={[{ item: {}, error: 'x', detail: 'disk full' }, { item: {}, error: 'x' }]} onRetry={onRetry} onDismiss={() => {}} />)
    expect(screen.getByText(/Couldn't create a folder for 2 agents: disk full/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('can-isolate offers the switch, disabled with an explanation when agents are live', async () => {
    const onSwitch = vi.fn()
    const { rerender } = render(<IsolationNotice kind="can-isolate" actionEnabled onSwitch={onSwitch} onDismiss={() => {}} />)
    expect(screen.getByText("Agents here share one folder, so their changes can collide.")).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Use separate folders' }))
    expect(onSwitch).toHaveBeenCalledTimes(1)
    rerender(<IsolationNotice kind="can-isolate" actionEnabled={false} onSwitch={onSwitch} onDismiss={() => {}} />)
    const btn = screen.getByRole('button', { name: 'Use separate folders' })
    expect(btn.disabled).toBe(true)
    expect(btn.title).toBe("Close this workspace's agents to switch.")
  })

  it('cannot-isolate shows the reason note and can be dismissed', async () => {
    const onDismiss = vi.fn()
    render(<IsolationNotice kind="cannot-isolate" reason="no-commits" onDismiss={onDismiss} />)
    expect(screen.getByText(/no commits yet/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('disables Retry while a retry is in flight', async () => {
    const onRetry = vi.fn()
    render(<IsolationNotice kind="spawn-failed" actionEnabled retrying failures={[{ item: {}, detail: 'd' }]} onRetry={onRetry} />)
    const btn = screen.getByRole('button', { name: 'Retry' })
    expect(btn.disabled).toBe(true)
    await userEvent.click(btn)
    expect(onRetry).not.toHaveBeenCalled()
  })
})
