// src/main/auto-namer.js
//
// Owns the Anthropic SDK client. Exposed only via IPC so the API key
// never crosses to the renderer.

import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 20

const SYSTEM = [
  'You name terminal tabs.',
  'Reply with 3 to 5 words, Title Case, no quotes, no punctuation, no trailing period.',
  'Describe what the Claude agent in this terminal is currently doing.',
  'If the terminal is idle or has no clear task, reply "Idle".',
].join(' ')

let client = null

function getClient() {
  if (client) return client
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  client = new Anthropic({ apiKey })
  return client
}

export function hasKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

// Renderer sanitization is also applied; this is belt-and-suspenders.
function sanitize(raw) {
  if (typeof raw !== 'string') return ''
  let s = raw.trim()
  s = s.replace(/^["'`]+|["'`]+$/g, '')
  s = s.replace(/[.!?]+$/, '')
  if (s.length > 40) s = s.slice(0, 40).trim()
  return s
}

export async function summarize(tail) {
  const c = getClient()
  if (!c) return { ok: false, reason: 'no-key' }
  if (typeof tail !== 'string' || tail.trim().length === 0) {
    return { ok: false, reason: 'empty' }
  }
  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: tail }],
    })
    const block = res?.content?.find(b => b.type === 'text')
    const name = sanitize(block?.text ?? '')
    if (!name) return { ok: false, reason: 'empty-response' }
    return { ok: true, name }
  } catch (err) {
    console.warn('[auto-namer] summarize failed:', err?.message ?? err)
    return { ok: false, reason: 'api' }
  }
}
