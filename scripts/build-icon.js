// Rasterize build/icon.svg into a multi-resolution build/icon.ico used by:
//  - electron-builder (referenced as `build.win.icon` in package.json)
//  - the dev BrowserWindow at runtime (so the taskbar icon matches in dev too)
//
// Run via `npm run build:icon` or implicitly through `postinstall`.

const { readFileSync, writeFileSync } = require('fs')
const { resolve, join } = require('path')
const sharp = require('sharp')
const pngToIco = require('png-to-ico')

const root = resolve(__dirname, '..')
const SVG = join(root, 'build', 'icon.svg')
const ICO = join(root, 'build', 'icon.ico')

// Windows taskbars render at multiple DPIs; embedding several sizes lets the
// shell pick the closest match instead of bicubic-blurring a single 256.
const SIZES = [16, 24, 32, 48, 64, 128, 256]

async function main() {
  const svg = readFileSync(SVG)
  // High density makes sharp rasterize the SVG at a much larger intermediate
  // resolution before downscaling, so 16/24px sizes keep their stroke detail.
  const pngs = await Promise.all(
    SIZES.map(size =>
      sharp(svg, { density: 384 })
        .resize(size, size, { kernel: 'lanczos3' })
        .png({ compressionLevel: 9 })
        .toBuffer()
    )
  )
  const ico = await pngToIco(pngs)
  writeFileSync(ICO, ico)
  console.log(`build-icon: wrote ${ICO} (${ico.length} bytes, ${SIZES.length} sizes)`)
}

main().catch(err => {
  console.error('build-icon failed:', err)
  process.exit(1)
})
