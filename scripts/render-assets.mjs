// Renders brand assets from the running dev server's #/assets page into public/.
// Usage: npm run dev (in another shell), then npm run icons [-- http://localhost:5173]
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// playwright is resolved via require so a globally installed copy works too
const { chromium } = createRequire(import.meta.url)('playwright')

const base = process.argv[2] ?? 'http://localhost:5173'
const out = new URL('../public/', import.meta.url).pathname

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1800 }, deviceScaleFactor: 1 })
await page.goto(`${base}/#/assets`)
await page.waitForTimeout(800)
await page.evaluate(() => document.fonts.ready)

for (const el of await page.locator('[data-asset]').all()) {
  const file = join(out, await el.getAttribute('data-asset'))
  await mkdir(dirname(file), { recursive: true })
  await el.screenshot({ path: file })
  console.log('wrote', file)
}

// Smaller icon sizes: re-render the 512 icon scaled down for crispness.
for (const [size, name] of [[192, 'icon-192.png'], [180, 'apple-touch-icon.png'], [32, 'favicon-32.png']]) {
  const p = await browser.newPage({ viewport: { width: 1400, height: 1800 }, deviceScaleFactor: size / 512 })
  await p.goto(`${base}/#/assets`)
  await p.waitForTimeout(600)
  await p.locator('[data-asset="icons/icon-512.png"]').screenshot({ path: join(out, 'icons', name) })
  await p.close()
  console.log('wrote', name)
}

// favicon.svg: the live SVG, cropped tight, with the glow and its gradient removed.
for (const el of await page.locator('[data-svg]').all()) {
  const name = await el.getAttribute('data-svg')
  const svg = await el.evaluate((node) => {
    const s = node.querySelector('svg').cloneNode(true)
    s.querySelector('defs')?.remove()
    s.querySelector('circle')?.remove() // glow
    s.setAttribute('viewBox', '34 52 172 172')
    s.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    for (const a of ['width', 'height', 'class', 'style', 'role', 'aria-label']) s.removeAttribute(a)
    return s.outerHTML
  })
  await writeFile(join(out, name), svg)
  console.log('wrote', name)
}

await writeFile(
  join(out, 'manifest.webmanifest'),
  JSON.stringify(
    {
      name: 'focusmaxxiing',
      short_name: 'focusmaxxiing',
      description: 'Pomodoro timer with real reports, exportable data, and Pip.',
      start_url: '/',
      display: 'standalone',
      background_color: '#F4EFE6',
      theme_color: '#E4572E',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  ) + '\n',
)
await browser.close()
