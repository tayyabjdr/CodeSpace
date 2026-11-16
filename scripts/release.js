// npm run release: build, then publish the installer to GitHub Releases.
//
// electron-builder uploads with GH_TOKEN. A long-lived token kept in an
// environment variable expires quietly and the upload then fails, so this
// borrows the token from the GitHub CLI login (`gh auth login`) for the
// length of the run instead. GH_TOKEN is only a fallback for machines
// without the CLI, so a stale value left in the environment can't win.

const { execSync } = require('child_process')

function ghToken() {
  const env = { ...process.env }
  delete env.GH_TOKEN
  delete env.GITHUB_TOKEN
  try {
    return execSync('gh auth token', { env, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

const token = ghToken() || process.env.GH_TOKEN
if (!token) {
  console.error('No GitHub token. Run `gh auth login` once, or set GH_TOKEN for this shell.')
  process.exit(1)
}

const run = (cmd) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, GH_TOKEN: token } })

run('npx electron-vite build')
run('npx electron-builder --publish always')
