import { describe, it, expect } from 'vitest'
import { isProbablyText, rejectBody } from '../../src/renderer/text-file.js'

describe('isProbablyText', () => {
  it('accepts common source and config extensions', () => {
    for (const name of ['App.jsx', 'main.js', 'style.css', 'notes.md', 'a.txt', 'tsconfig.json', 'run.sh', 'q.sql', 'data.csv', 'page.html', 'conf.yaml', 'log.log']) {
      expect(isProbablyText(name), name).toBe(true)
    }
  })

  it('rejects known binary extensions', () => {
    for (const name of ['logo.png', 'clip.mp4', 'song.mp3', 'bundle.zip', 'app.exe', 'core.dll', 'doc.pdf', 'sheet.xlsx', 'Inter.woff2', 'store.sqlite']) {
      expect(isProbablyText(name), name).toBe(false)
    }
  })

  it('is case-insensitive about the extension', () => {
    expect(isProbablyText('LOGO.PNG')).toBe(false)
    expect(isProbablyText('Readme.MD')).toBe(true)
  })

  it('accepts extensionless files', () => {
    expect(isProbablyText('Dockerfile')).toBe(true)
    expect(isProbablyText('LICENSE')).toBe(true)
    expect(isProbablyText('Makefile')).toBe(true)
  })

  it('accepts dotfiles, whose leading dot is not an extension', () => {
    expect(isProbablyText('.gitignore')).toBe(true)
    expect(isProbablyText('.env')).toBe(true)
    expect(isProbablyText('.npmrc')).toBe(true)
  })

  it('reads the last extension of a multi-dot name', () => {
    expect(isProbablyText('archive.tar.gz')).toBe(false)
    expect(isProbablyText('app.config.js')).toBe(true)
  })

  it('accepts unknown extensions, leaving the null-byte probe to decide', () => {
    expect(isProbablyText('weird.xyzzy')).toBe(true)
  })

  it('reads the extension off a full Windows path', () => {
    expect(isProbablyText('C:\\Users\\TJ\\pics\\shot.png')).toBe(false)
    expect(isProbablyText('C:\\Users\\TJ\\src\\index.ts')).toBe(true)
  })

  it('reads the extension off a posix path', () => {
    expect(isProbablyText('/home/tj/pics/shot.png')).toBe(false)
    expect(isProbablyText('/home/tj/src/index.ts')).toBe(true)
  })

  it('rejects empty or non-string input', () => {
    expect(isProbablyText('')).toBe(false)
    expect(isProbablyText(null)).toBe(false)
    expect(isProbablyText(undefined)).toBe(false)
  })

  it('ignores a trailing directory separator', () => {
    expect(isProbablyText('C:\\Users\\TJ\\src\\')).toBe(false)
  })
})

describe('rejectBody', () => {
  it('explains each refusal reason in one plain line', () => {
    expect(rejectBody('not-text')).toBe('Not a text file')
    expect(rejectBody('binary')).toBe('Not a text file')
    expect(rejectBody('too-large')).toBe('Larger than 20 MB')
    expect(rejectBody('directory')).toBe("That's a folder")
    expect(rejectBody('not-found')).toBe('File not found')
    expect(rejectBody('denied')).toBe('Permission denied')
  })

  it('falls back for an unrecognised reason', () => {
    expect(rejectBody('unknown')).toBe("Couldn't read this file")
    expect(rejectBody('something-else')).toBe("Couldn't read this file")
  })
})
