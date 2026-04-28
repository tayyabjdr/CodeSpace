import { useState, useCallback, useEffect } from 'react'
import Toolbar from './components/Toolbar.jsx'
import TerminalPane from './components/TerminalPane.jsx'
import './App.css'

export default function App() {
  const [terminals, setTerminals] = useState([])
  const [focusedId, setFocusedId] = useState(null)

  const addTerminal = useCallback((shell) => {
    const id = crypto.randomUUID()
    setTerminals(prev => [...prev, { id, shell }])
  }, [])

  const removeTerminal = useCallback((id) => {
    setTerminals(prev => prev.filter(t => t.id !== id))
    setFocusedId(prev => prev === id ? null : prev)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault()
        addTerminal('powershell')
      }
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault()
        if (focusedId) removeTerminal(focusedId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [addTerminal, removeTerminal, focusedId])

  const cols = Math.min(terminals.length, 4) || 1

  return (
    <div className="app">
      <Toolbar onAdd={addTerminal} />
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {terminals.map(t => (
          <TerminalPane
            key={t.id}
            id={t.id}
            shell={t.shell}
            onClose={removeTerminal}
            onFocus={setFocusedId}
          />
        ))}
      </div>
    </div>
  )
}
