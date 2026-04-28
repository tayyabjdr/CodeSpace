import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Toolbar from '../../src/renderer/components/Toolbar.jsx'

describe('Toolbar', () => {
  it('renders Add Terminal button', () => {
    render(<Toolbar onAdd={vi.fn()} />)
    expect(screen.getByText('+ Add Terminal')).toBeInTheDocument()
  })

  it('renders PowerShell and cmd options', () => {
    render(<Toolbar onAdd={vi.fn()} />)
    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('powershell')
    expect(screen.getByRole('option', { name: 'PowerShell' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'cmd.exe' })).toBeInTheDocument()
  })

  it('calls onAdd with powershell by default', () => {
    const onAdd = vi.fn()
    render(<Toolbar onAdd={onAdd} />)
    fireEvent.click(screen.getByText('+ Add Terminal'))
    expect(onAdd).toHaveBeenCalledWith('powershell')
  })

  it('calls onAdd with cmd when cmd selected', () => {
    const onAdd = vi.fn()
    render(<Toolbar onAdd={onAdd} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cmd' } })
    fireEvent.click(screen.getByText('+ Add Terminal'))
    expect(onAdd).toHaveBeenCalledWith('cmd')
  })

  it('shows keyboard shortcut hints', () => {
    render(<Toolbar onAdd={vi.fn()} />)
    expect(screen.getByText(/Ctrl\+T/)).toBeInTheDocument()
    expect(screen.getByText(/Ctrl\+W/)).toBeInTheDocument()
  })
})
