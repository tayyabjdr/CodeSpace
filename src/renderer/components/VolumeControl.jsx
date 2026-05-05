import { useEffect, useRef, useState } from 'react'
import * as volumeStore from '../volume-store.js'
import { playDoneSound } from '../done-sound.js'
import './VolumeControl.css'

const SpeakerHigh = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 5L6 9H3v6h3l5 4V5z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
)

const SpeakerLow = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 5L6 9H3v6h3l5 4V5z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
  </svg>
)

const SpeakerMuted = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 5L6 9H3v6h3l5 4V5z" />
    <line x1="22" y1="9" x2="16" y2="15" />
    <line x1="16" y1="9" x2="22" y2="15" />
  </svg>
)

function pickSpeaker(volume, muted) {
  if (muted || volume === 0) return <SpeakerMuted />
  if (volume < 50) return <SpeakerLow />
  return <SpeakerHigh />
}

export default function VolumeControl() {
  const [{ volume, muted }, setState] = useState(volumeStore.getState())
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => volumeStore.subscribe(setState), [])

  // Close popover on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const fill = `${volume}%`

  return (
    <div className="vol" ref={rootRef}>
      <button
        type="button"
        className={`vol-trigger${open ? ' is-open' : ''}${muted ? ' is-muted' : ''}`}
        onClick={() => setOpen(o => !o)}
        title={muted ? 'Sound muted' : `Sound: ${volume}%`}
        aria-label="Notification sound"
        aria-expanded={open}
      >
        {pickSpeaker(volume, muted)}
      </button>

      {open && (
        <div className="vol-pop" role="dialog" aria-label="Notification sound">
          <div className="vol-pop-row">
            <span className="vol-pop-label">
              Sound: <span className="vol-pop-pct">{muted ? 'muted' : `${volume}%`}</span>
            </span>
            <button
              type="button"
              className={`vol-pop-mute${muted ? ' is-muted' : ''}`}
              onClick={() => volumeStore.setMuted(!muted)}
              title={muted ? 'Unmute' : 'Mute'}
              aria-pressed={muted}
            >
              {muted ? <SpeakerLow /> : <SpeakerMuted />}
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => {
              if (muted) volumeStore.setMuted(false)
              volumeStore.setVolume(e.target.value)
            }}
            // Preview the ding when the user finishes adjusting — covers
            // mouse release, touch release, and keyboard arrow tweaks.
            onMouseUp={playDoneSound}
            onTouchEnd={playDoneSound}
            onKeyUp={(e) => {
              if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') {
                playDoneSound()
              }
            }}
            className={`vol-pop-slider${muted ? ' is-muted' : ''}`}
            style={{ '--vol-fill': fill }}
            aria-label="Sound volume"
          />
        </div>
      )}
    </div>
  )
}
