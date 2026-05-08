// src/main/auto-namer.js
//
// Generates a 3–5 word title for a terminal pane by shelling out to the
// already-authenticated `claude` CLI in headless mode (`claude -p`). This
// piggybacks on the user's Claude Max subscription instead of requiring a
// separate ANTHROPIC_API_KEY. Trades latency (subprocess startup) for cost.

import { spawn } from 'child_process'
import { isClaudeAvailable } from './pty-manager.js'

const TIMEOUT_MS = 30_000

const SYSTEM = [
  'You name terminal tabs.',
  'Reply with 3 to 5 words, Title Case, no quotes, no punctuation, no trailing period.',
  'Describe what the Claude agent in this terminal is currently doing.',
  'If the terminal is idle or has no clear task, reply "Idle".',
].join(' ')

export function hasKey() {
  // The IPC channel is still named `agentName:hasKey` for renderer
  // compatibility; the answer is now whether the `claude` CLI is on PATH.
  return isClaudeAvailable()
}

function sanitize(raw) {
  if (typeof raw !== 'string') return ''
  let s = raw.trim()
  s = s.replace(/^["'`]+|["'`]+$/g, '')
  s = s.replace(/[.!?]+$/, '')
  if (s.length > 40) s = s.slice(0, 40).trim()
  return s
}

function runClaude(prompt) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('claude', ['-p', '--dangerously-skip-permissions'], {
        shell: true,
        windowsHide: true,
      })
    } catch (err) {
      resolve({ ok: false, reason: 'spawn', detail: err?.message })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill() } catch {}
      resolve(result)
    }

    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), TIMEOUT_MS)

    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => finish({ ok: false, reason: 'error', detail: err?.message }))
    child.on('exit', (code) => {
      if (code === 0) finish({ ok: true, text: stdout })
      else finish({ ok: false, reason: 'exit', code, detail: stderr.trim() || stdout.trim() })
    })

    try {
      child.stdin.write(prompt)
      child.stdin.end()
    } catch (err) {
      finish({ ok: false, reason: 'stdin', detail: err?.message })
    }
  })
}

export async function summarize(tail) {
  if (!isClaudeAvailable()) return { ok: false, reason: 'no-cli' }
  if (typeof tail !== 'string' || tail.trim().length === 0) {
    return { ok: false, reason: 'empty' }
  }
  const prompt = `${SYSTEM}\n\nTerminal output:\n${tail}`
  const res = await runClaude(prompt)
  if (!res.ok) {
    console.warn('[auto-namer] claude -p failed:', res.reason, res.detail ?? '')
    return { ok: false, reason: res.reason }
  }
  const name = sanitize(res.text)
  if (!name) return { ok: false, reason: 'empty-response' }
  return { ok: true, name }
}
