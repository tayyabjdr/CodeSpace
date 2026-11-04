// xterm has to be told when it is driving a Windows ConPTY. Two behaviours
// hang off the `windowsPty` option, and both are wrong for CodeSpace while it
// is left unset:
//
//  1. Growing the terminal. With no `windowsPty`, xterm pulls rows back out of
//     the scrollback and into the viewport (it decrements ybase). ConPTY does
//     not work that way — it opens blank rows at the bottom and lets the
//     attached program repaint into them. The two disagree, so the rows xterm
//     pulled up stay on screen *and* the agent reprints them lower down: the
//     duplicated lines and blank gaps you get after stretching a pane out and
//     back in. Setting the option makes xterm append blank rows instead, which
//     is what ConPTY actually did.
//
//  2. Reflow. Only builds >= 21376 emit real line-wrap sequences. Below that,
//     xterm turns reflow off and falls back to "the last cell isn't blank, so
//     the line must be wrapped". Handing over the real build number lets xterm
//     make that call itself instead of us guessing.
//
// node-pty picks ConPTY over winpty at build 18309 and reads the build the
// same way — the third component of os.release() (windowsPtyAgent.js).

export const CONPTY_MIN_BUILD = 18309

export function parseWindowsBuild(osRelease) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(osRelease ?? '')
  return match ? parseInt(match[3], 10) : 0
}

export function windowsPtyOption(platform, osRelease) {
  if (platform !== 'win32') return undefined
  const buildNumber = parseWindowsBuild(osRelease)
  // A build of 0 would switch xterm's reflow off for everyone. If we can't
  // read the release string, leave xterm on its defaults.
  if (!buildNumber) return undefined
  return {
    backend: buildNumber >= CONPTY_MIN_BUILD ? 'conpty' : 'winpty',
    buildNumber
  }
}
