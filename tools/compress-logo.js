/**
 * One-off asset prep: shrink Ourcodeqs.png into src/assets/ourcode-logo.png
 * using Electron's built-in nativeImage (no extra dependencies).
 * Run: npx electron tools/compress-logo.js
 */
const { app, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

const SRC = 'C:/Users/29486/Downloads/Ourcodeqs.png'
const OUT = path.join(__dirname, '..', 'src', 'assets', 'ourcode-logo.png')
const MAX_EDGE = 256

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(SRC)
  if (img.isEmpty()) {
    console.error(`[compress-logo] failed to load ${SRC}`)
    app.exit(1)
    return
  }
  const { width, height } = img.getSize()
  const scale = Math.min(MAX_EDGE / width, MAX_EDGE / height, 1)
  const resized = img.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  })
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, resized.toPNG())
  const bytes = fs.statSync(OUT).size
  console.log(`[compress-logo] ${width}x${height} -> ${resized.getSize().width}x${resized.getSize().height} (${bytes} bytes)`)
  app.exit(0)
})
