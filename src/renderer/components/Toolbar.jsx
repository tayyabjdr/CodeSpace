import { useState } from 'react'
import './Toolbar.css'

export default function Toolbar({ onAdd }) {
  const [shell, setShell] = useState('powershell')

  return (
    <div className="toolbar">
      <select value={shell} onChange={e => setShell(e.target.value)}>
        <option value="powershell">PowerShell</option>
        <option value="cmd">cmd.exe</option>
      </select>
      <button onClick={() => onAdd(shell)}>+ Add Terminal</button>
      <span className="hint">Ctrl+T add · Ctrl+W close focused</span>
    </div>
  )
}
