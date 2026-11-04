// Decides whether a path that arrived from outside the terminal — a drop on
// the editor pane, or the Open dialog — can be opened, WITHOUT committing the
// editor to it. Answering first is what lets a refused file leave the
// currently-open one untouched.
//
// Pure apart from the injected probe, following path-resolver.js.
// Returns null when the file is openable, otherwise a refusal reason that
// text-file.js turns into a line of copy.

import { isProbablyText } from './text-file.js'

export async function checkOpenable(path, { probeFile }) {
  // The extension gate runs first so an obvious refusal costs no IPC. The
  // EditorPane runs it too, for instant feedback on a drop; this call is what
  // covers the Open dialog.
  if (!isProbablyText(path)) return 'not-text'

  let result
  try {
    result = await probeFile(path)
  } catch (err) {
    console.error('editor.probeFile failed', err)
    return 'unknown'
  }
  if (!result) return 'unknown'
  if (result.ok) return null
  return result.reason ?? 'unknown'
}
