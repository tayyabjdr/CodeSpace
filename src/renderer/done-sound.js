// "Agent done" notification ding. Shared singleton AudioContext (Chrome
// caps live contexts around 6 — one-per-pane runs out in a long session).

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

export function playDoneSound() {
  try {
    const peak = getDoneSoundGain()
    if (peak <= 0) return
    const ctx = getAudioCtx()
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(660, ctx.currentTime)
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12)
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(peak, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.45)
  } catch {}
}
