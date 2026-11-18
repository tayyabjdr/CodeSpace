import { useCallback, useEffect, useRef, useState } from 'react'
import { useMergeStatus } from '../merge-status.js'
import { useQuiet } from '../pty-activity.js'
import { DONE_SILENCE_MS } from '../constants.js'
import './FinishControl.css'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

export function countsLabel(info) {
  if (!info) return ''
  const parts = []
  if (info.ahead > 0) parts.push(plural(info.ahead, 'commit'))
  if (info.files > 0) parts.push(plural(info.files, 'file'))
  return parts.join(', ')
}

// { label, tone, title } for a merge status, or null when there is nothing to
// say (no Finish yet, or cancelled back to idle).
export function statusView(status) {
  if (!status) return null
  const { state, target, detail, logPath } = status
  const tip = [detail, logPath ? `Log: ${logPath}` : null].filter(Boolean).join(' · ') || undefined
  switch (state) {
    case 'queued': return { label: 'Queued', tone: 'plain', title: 'Waiting to start' }
    case 'testing': return { label: 'Testing', tone: 'plain', title: target ? `Checking before merging into ${target}` : undefined }
    case 'merged': return { label: `Merged into ${target}`, tone: 'success' }
    case 'merged-untested': return { label: 'Merged, untested', tone: 'success', title: 'No test or build script was found, so nothing was checked' }
    case 'tests-failed': return { label: 'Tests failed', tone: 'failure', title: tip }
    case 'conflict': return { label: 'Conflict', tone: 'failure', title: tip }
    case 'blocked': return { label: `Blocked: ${detail || 'unknown reason'}`, tone: 'failure', title: tip }
    default: return null
  }
}

// Renders nothing (and subscribes to nothing) without a merge API, a repo or
// an agent, e.g. tests and plain shared panes.
export default function FinishControl(props) {
  const api = typeof window !== 'undefined' ? window.electronAPI?.merge : null
  if (!api || !props.repoDir || !props.agentId) return null
  return <FinishControlInner api={api} {...props} />
}

function FinishControlInner(props) {
  const {
    info, status, seq, view, state, counts, lockNote,
    disabled, finishTitle, onMouseDown, onMouseLeave, onFinish
  } = useFinish(props)

  return (
    <>
      {counts && (
        <>
          <span className="fc-sep" aria-hidden>·</span>
          <span className="fc-counts">{counts}</span>
        </>
      )}
      {view && (
        <>
          <span className="fc-sep" aria-hidden>·</span>
          <span
            key={seq}
            className="fc-status"
            data-tone={view.tone}
            title={view.title}
          >
            {view.label}
          </span>
        </>
      )}
      {lockNote && (
        <>
          <span className="fc-sep" aria-hidden>·</span>
          <span className="fc-note" title="The lockfile changed. Running it for you could fail on Windows file locks from a live dev server.">
            Run an install in the main folder.
          </span>
        </>
      )}
      <button
        type="button"
        className="fc-finish"
        disabled={disabled}
        title={finishTitle}
        onMouseDown={onMouseDown}
        onMouseLeave={onMouseLeave}
        onClick={onFinish}
      >
        Finish
      </button>
    </>
  )
}

// Everything behind a Finish button: the branch's counts, its merge status,
// and the quiet-gated click. Shared by the pane's subheader and the sidebar's
// agent card so both buttons behave identically. `api` is window.electronAPI.merge.
export function useFinish({ api, agentId, ptyId, repoDir, agentName }) {
  const status = useMergeStatus(agentId)
  const quiet = useQuiet(ptyId, DONE_SILENCE_MS)
  const [info, setInfo] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const reqRef = useRef(0)

  const refresh = useCallback(() => {
    if (typeof api.info !== 'function') return
    const req = ++reqRef.current
    Promise.resolve(api.info({ repoDir, agentId }))
      .then((res) => { if (req === reqRef.current && res) setInfo(res) })
      .catch(() => {})
  }, [api, repoDir, agentId])

  // After mount and after each status change (seq is per event).
  const seq = status?.seq ?? 0
  useEffect(() => { refresh() }, [refresh, seq])
  // When the pane goes quiet. No timer: only the busy-to-quiet edge.
  useEffect(() => { if (quiet) refresh() }, [quiet, refresh])

  const view = statusView(status)
  const state = status?.state
  const running = state === 'queued' || state === 'testing'
  const target = info?.target ?? status?.target ?? null
  const nothingToMerge = !info || (info.ahead === 0 && !info.dirty)
  const blocked = submitting || running || nothingToMerge || !target
  // Set on mousedown when the pane was quiet at that moment. Pressing the
  // button can make the pane print (the terminal losing focus, a redraw), and
  // a button that turns disabled between mousedown and mouseup swallows the
  // click. So quiet is judged at the press, not at the release.
  const [pressedQuiet, setPressedQuiet] = useState(false)
  const disabled = blocked || (!quiet && !pressedQuiet)

  const counts = countsLabel(info)
  const lockNote = state === 'merged' && status.lockfileChanged

  let finishTitle
  if (!target) finishTitle = info ? 'The main folder is on a detached HEAD' : 'Checking this branch'
  else finishTitle = `Test and merge into ${target}`

  const onMouseDown = (e) => {
    // Keep focus in the terminal, so pressing Finish doesn't send it a
    // focus-out the agent answers by printing.
    e.preventDefault()
    if (e.button === 0 && !blocked && quiet) setPressedQuiet(true)
  }

  const onFinish = (e) => {
    e.stopPropagation()
    const ok = !blocked && (quiet || pressedQuiet)
    setPressedQuiet(false)
    if (!ok) return
    setSubmitting(true)
    Promise.resolve(api.finish({ repoDir, agentId, agentName }))
      .catch(() => {})
      .finally(() => setSubmitting(false))
  }

  const onMouseLeave = () => setPressedQuiet(false)

  return {
    info, status, seq, view, state, counts, lockNote,
    disabled, finishTitle, onMouseDown, onMouseLeave, onFinish
  }
}
