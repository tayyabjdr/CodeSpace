import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ConfirmDialog from '../../src/renderer/components/ConfirmDialog.jsx'

function setup(props = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const onExtra = vi.fn()
  render(
    <ConfirmDialog
      message="Are you sure?"
      confirmLabel="Confirm"
      cancelLabel="Cancel"
      onConfirm={onConfirm}
      onCancel={onCancel}
      onExtra={onExtra}
      {...props}
    />
  )
  return { onConfirm, onCancel, onExtra }
}

describe('ConfirmDialog focus', () => {
  it('focuses the confirm button by default', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus()
  })

  it('focuses the cancel button when initialFocus is "cancel"', () => {
    setup({ initialFocus: 'cancel' })
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })
})

describe('ConfirmDialog keyboard', () => {
  it('confirms on Enter when confirm holds focus', () => {
    const { onConfirm, onCancel } = setup()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels on Enter when cancel holds focus, and never confirms', () => {
    const { onConfirm, onCancel } = setup({ initialFocus: 'cancel' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('fires onExtra on Enter when the extra button holds focus', () => {
    const { onConfirm, onExtra } = setup({ extraLabel: 'Discard' })
    screen.getByRole('button', { name: 'Discard' }).focus()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onExtra).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('cancels on Escape', () => {
    const { onCancel } = setup()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('ignores Enter when focus is outside the dialog', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const { onConfirm, onCancel } = setup()
    outside.focus()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    outside.remove()
  })
})
