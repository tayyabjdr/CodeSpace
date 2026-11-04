// Cheap client-side gate for "can the editor open this?". Deliberately a
// DENYLIST: anything not on the list gets through to main's null-byte probe,
// which is the authoritative check. An allowlist would hide Dockerfile,
// LICENSE, .env and every extensionless or unfamiliar text file.

const BINARY_EXTENSIONS = new Set([
  // images
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'avif', 'ico', 'icns',
  'tif', 'tiff', 'psd', 'ai', 'eps', 'heic', 'heif', 'raw', 'cr2', 'nef',
  // video
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg',
  // audio
  'mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'aac', 'wma', 'aiff', 'opus', 'mid', 'midi',
  // archives
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'lz4', 'zst', 'jar', 'war',
  // executables and build artifacts
  'exe', 'dll', 'so', 'dylib', 'msi', 'bin', 'lib', 'pdb', 'node', 'wasm',
  'class', 'pyc', 'pyd', 'deb', 'rpm', 'dmg', 'apk', 'cab', 'sys', 'iso', 'img',
  // documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  // fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // databases
  'sqlite', 'sqlite3', 'db', 'mdb', 'accdb', 'realm',
])

const REJECT_BODIES = {
  'not-text':  'Not a text file',
  'binary':    'Not a text file',
  'too-large': 'Larger than 20 MB',
  'directory': "That's a folder",
  'not-found': 'File not found',
  'denied':    'Permission denied',
}

// Last dot in the filename, ignoring a leading dot so `.gitignore` reads as a
// name with no extension rather than an extension of `gitignore`.
export function extensionOf(nameOrPath) {
  if (typeof nameOrPath !== 'string') return ''
  const name = nameOrPath.match(/[^\\/]+$/)?.[0] ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function isProbablyText(nameOrPath) {
  if (typeof nameOrPath !== 'string') return false
  const name = nameOrPath.match(/[^\\/]+$/)?.[0] ?? ''
  if (name.length === 0) return false
  return !BINARY_EXTENSIONS.has(extensionOf(name))
}

export function rejectBody(reason) {
  return REJECT_BODIES[reason] ?? "Couldn't read this file"
}
