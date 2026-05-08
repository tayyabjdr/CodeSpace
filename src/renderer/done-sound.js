// "Agent done" notification sounds. Shared singleton AudioContext (Chrome
// caps live contexts around 6 — one-per-pane runs out in a long session).
//
// All tones use sine/triangle waves with soft attacks — no square/saw —
// so the palette stays subtle rather than harsh.

import { getDoneSoundGain, getSoundChoice } from './volume-store.js'

let sharedAudioCtx = null

function getAudioCtx() {
  if (!sharedAudioCtx) {
    try { sharedAudioCtx = new AudioContext() } catch { return null }
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume?.().catch(() => {})
  }
  return sharedAudioCtx
}

// Schedule a single tone with an envelope. `freqs` is either a number
// (constant pitch) or an array of [hz, deltaSeconds] tuples.
function tone(ctx, peak, { type = 'sine', freqs, attack = 0.02, release = 0.45, startAt = 0 }) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = type
  const t0 = ctx.currentTime + startAt
  if (Array.isArray(freqs)) {
    for (const [hz, dt] of freqs) osc.frequency.setValueAtTime(hz, t0 + dt)
  } else {
    osc.frequency.setValueAtTime(freqs, t0)
  }
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.linearRampToValueAtTime(peak, t0 + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + release)
  osc.start(t0)
  osc.stop(t0 + attack + release + 0.05)
}

const SOUNDS = {
  chirp: {
    label: 'Chirp',
    play: (ctx, peak) => tone(ctx, peak, {
      freqs: [[660, 0], [880, 0.12]],
      attack: 0.02, release: 0.43
    })
  },
  ding: {
    label: 'Ding',
    play: (ctx, peak) => tone(ctx, peak, {
      freqs: 1320,
      attack: 0.005, release: 0.6
    })
  },
  chime: {
    label: 'Chime',
    play: (ctx, peak) => {
      tone(ctx, peak * 0.85, { freqs: 523.25, attack: 0.01, release: 0.55, startAt: 0 })
      tone(ctx, peak * 0.7,  { freqs: 659.25, attack: 0.01, release: 0.55, startAt: 0.07 })
      tone(ctx, peak * 0.6,  { freqs: 783.99, attack: 0.01, release: 0.6,  startAt: 0.14 })
    }
  },
  pop: {
    label: 'Pop',
    play: (ctx, peak) => tone(ctx, peak, {
      type: 'triangle',
      freqs: [[220, 0], [80, 0.08]],
      attack: 0.005, release: 0.13
    })
  },
  soft: {
    label: 'Soft',
    play: (ctx, peak) => tone(ctx, peak * 0.9, {
      type: 'triangle',
      freqs: 440,
      attack: 0.06, release: 0.95
    })
  }
}

export const DEFAULT_SOUND = 'chirp'

export const SOUND_OPTIONS = Object.entries(SOUNDS).map(([id, def]) => ({
  id,
  label: def.label
}))

export function playDoneSound(forceId) {
  try {
    const peak = getDoneSoundGain()
    if (peak <= 0) return
    const ctx = getAudioCtx()
    if (!ctx) return
    const id = forceId || getSoundChoice()
    const def = SOUNDS[id] || SOUNDS[DEFAULT_SOUND]
    def.play(ctx, peak)
  } catch {}
}
