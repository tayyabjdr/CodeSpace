import { useState, useCallback, useEffect, useRef } from 'react'
import Onboarding from './components/Onboarding.jsx'
import Toolbar from './components/Toolbar.jsx'
import TerminalPane from './components/TerminalPane.jsx'
import './design-tokens.css'
import './App.css'

export default function App() {
  const [appPhase, setAppPhase] = useState('onboarding')
  const [terminals, setTerminals] = useState([])
  const [focusedId, setFocusedId] = useState(null)
  const agentCounterRef = useRef(0)
  const projectDirRef = useRef('')

  const handleLaunch = useCallback((count, directory) => {
    agentCounterRef.current = 0
    projectDirRef.current = directory
    const agents = Array.from({ length: count }, () => {
      agentCounterRef.current += 1
      return {
        id: crypto.randomUUID(),
        shell: 'claude',
        agentNum: agentCounterRef.current,
        cwd: directory
      }
    })
    setTerminals(agents)
    setFocusedId(agents[0].id)
    setAppPhase('running')
  }, [])

  const addAgent = useCallback(() => {
    agentCounterRef.current += 1
    const id = crypto.randomUUID()
    setTerminals(prev => [...prev, {
      id,
      shell: 'claude',
      agentNum: agentCounterRef.current,
      cwd: projectDirRef.current
    }])
  }, [])

  const removeTerminal = useCallback((id) => {
    setTerminals(prev => prev.filter(t => t.id !== id))
    setFocusedId(prev => prev === id ? null : prev)
  }, [])

  useEffect(() => {
    if (appPhase === 'running' && terminals.length === 0) setAppPhase('onboarding')
  }, [terminals, appPhase])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (appPhase !== 'running') return
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault()
        addAgent()
      }
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault()
        if (focusedId) removeTerminal(focusedId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [addAgent, removeTerminal, focusedId, appPhase])

  if (appPhase === 'onboarding') {
    return <Onboarding onLaunch={handleLaunch} />
  }

  const cols = Math.min(terminals.length, 4) || 1

  return (
    <div className="app">
      <Toolbar onAdd={addAgent} agentCount={terminals.length} />
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {terminals.map(t => (
          <TerminalPane
            key={t.id}
            id={t.id}
            shell={t.shell}
            cwd={t.cwd}
            agentNum={t.agentNum}
            onClose={removeTerminal}
            onFocus={setFocusedId}
            isFocused={focusedId === t.id}
          />
        ))}
      </div>
    </div>
  )
}
