// "Agent done" notification sound. Single soft triangle-wave tone, shared
// singleton AudioContext (Chrome caps live contexts around 6 — one-per-pane
// runs out in a long session).

import { getDoneSoundGain } from './volume-store.js'

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

function playSoft(ctx, peak) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'triangle'
  const t0 = ctx.currentTime
  osc.frequency.setValueAtTime(440, t0)
  const attack = 0.06
  const release = 0.95
  const target = peak * 0.9
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.linearRampToValueAtTime(target, t0 + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + release)
  osc.start(t0)
  osc.stop(t0 + attack + release + 0.05)
}

export function playDoneSound() {
  try {
    const peak = getDoneSoundGain()
    if (peak <= 0) return
    const ctx = getAudioCtx()
    if (!ctx) return
    playSoft(ctx, peak)
  } catch {}
}
