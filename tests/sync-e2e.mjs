// Two-device sync test against the real Cloudflare runtime (wrangler pages dev + local D1).
// Each browser context is a separate "device" with its own IndexedDB.  Run: npm run e2e:sync
import { createRequire } from 'node:module'
import { spawn, execSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const { chromium } = createRequire(import.meta.url)('playwright')
const PORT = 8799
const URL = `http://localhost:${PORT}/#/`
const persist = await mkdtemp(join(tmpdir(), 'fm-d1-'))
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' }

execSync(`npx wrangler d1 migrations apply focusmaxxiing --local --persist-to ${persist}`, { env, stdio: 'ignore' })
const server = spawn('npx', ['wrangler', 'pages', 'dev', 'dist', '--port', String(PORT), '--persist-to', persist, '--binding', 'DEV_AUTH=1'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('wrangler did not start')), 60_000)
  server.stdout.on('data', (d) => String(d).includes('Ready on') && (clearTimeout(t), resolve()))
})

const browser = await chromium.launch()
let failed = 0
const step = async (name, fn) => {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').slice(0, 6).join('\n    ')}`)
  }
}

async function device() {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(URL)
  await page.getByRole('timer').waitFor()
  return { ctx, page }
}
async function openSettings(page) {
  if (!(await page.getByRole('dialog', { name: 'Settings' }).isVisible())) await page.getByRole('button', { name: 'Settings' }).click()
  return page.getByRole('dialog', { name: 'Settings' })
}
async function closeSettings(page) {
  if (await page.getByRole('dialog', { name: 'Settings' }).isVisible()) await page.keyboard.press('Escape')
}
async function signIn(page) {
  const d = await openSettings(page)
  await d.getByRole('button', { name: 'Sign in (dev)' }).click()
  await d.getByText('Signed in as me@example.com').waitFor()
  await d.getByText(/Synced just now/).waitFor({ timeout: 10_000 })
  await closeSettings(page)
}
async function syncNow(page) {
  const d = await openSettings(page)
  await d.getByRole('button', { name: 'Sync now' }).click()
  await d.getByText(/Synced just now/).waitFor({ timeout: 10_000 })
  await page.waitForTimeout(300)
  await closeSettings(page)
}
async function addTask(page, title, project) {
  await page.getByRole('button', { name: '+ Add task' }).click()
  await page.getByPlaceholder('What are you working on?').fill(title)
  if (project) {
    await page.locator('select[id^=proj-]').selectOption('__new__')
    await page.getByPlaceholder('Project name').fill(project)
  }
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: `Work on “${title}”` }).waitFor()
}
const task = (page, title) => page.getByRole('button', { name: `Work on “${title}”` })

const A = await device()
const B = await device()

await step('device A works offline-first and uploads on sign-in', async () => {
  await addTask(A.page, 'Shared essay', 'Writing')
  const d = await openSettings(A.page)
  await d.getByLabel('Focus', { exact: true }).fill('40')
  await closeSettings(A.page)
  await A.page.goto(URL.replace('#/', '#/reports'))
  await A.page.getByRole('button', { name: 'Explore with sample data' }).click()
  await A.page.getByText('You’re looking at sample data.').waitFor()
  await A.page.getByRole('button', { name: '+ Add session' }).click()
  await A.page.getByLabel('Note').fill('Logged on A')
  await A.page.getByRole('button', { name: 'Add session', exact: true }).click()
  await A.page.goto(URL)
  await A.page.getByRole('timer').waitFor()
  await signIn(A.page)
})

await step('device B signs in and receives tasks, projects, sessions and settings (not sample data)', async () => {
  await signIn(B.page)
  await task(B.page, 'Shared essay').waitFor({ timeout: 10_000 })
  assert.equal(await B.page.getByRole('timer').innerText(), '40:00')
  await B.page.goto(URL.replace('#/', '#/reports'))
  await B.page.getByRole('cell', { name: 'Logged on A' }).waitFor()
  assert.equal(await B.page.getByText('You’re looking at sample data.').count(), 0)
  await B.page.goto(URL)
  await B.page.getByRole('timer').waitFor()
})

await step('an edit on B reaches A', async () => {
  await B.page.getByRole('button', { name: 'Edit “Shared essay”' }).click()
  await B.page.getByPlaceholder('What are you working on?').fill('Shared essay, v2')
  await B.page.getByRole('button', { name: 'Save', exact: true }).click()
  await syncNow(B.page)
  await syncNow(A.page)
  await task(A.page, 'Shared essay, v2').waitFor({ timeout: 10_000 })
})

await step('changes made offline sync when the device reconnects', async () => {
  await B.ctx.setOffline(true)
  await addTask(B.page, 'Written on the train')
  await B.page.waitForTimeout(2500)
  assert.match(await B.page.locator('footer').innerText(), /OFFLINE/i)
  await B.ctx.setOffline(false)
  await B.page.evaluate(() => window.dispatchEvent(new Event('online')))
  await B.page.locator('footer').getByText(/Synced/i).waitFor({ timeout: 10_000 })
  await syncNow(A.page)
  await task(A.page, 'Written on the train').waitFor({ timeout: 10_000 })
})

await step('a delete on A disappears on B', async () => {
  await A.page.getByRole('button', { name: 'Edit “Written on the train”' }).click()
  await A.page.getByRole('button', { name: 'Delete' }).click()
  await syncNow(A.page)
  await syncNow(B.page)
  await task(B.page, 'Written on the train').waitFor({ state: 'detached', timeout: 10_000 })
})

await step('newest edit wins when both devices edit the same task', async () => {
  await A.page.getByRole('button', { name: 'Edit “Shared essay, v2”' }).click()
  await A.page.getByPlaceholder('What are you working on?').fill('Edited on A first')
  await A.page.getByRole('button', { name: 'Save', exact: true }).click()
  await A.page.waitForTimeout(50)
  await B.page.getByRole('button', { name: 'Edit “Shared essay, v2”' }).click()
  await B.page.getByPlaceholder('What are you working on?').fill('Edited on B later')
  await B.page.getByRole('button', { name: 'Save', exact: true }).click()
  await syncNow(B.page)
  await syncNow(A.page)
  await syncNow(B.page)
  await task(A.page, 'Edited on B later').waitFor({ timeout: 10_000 })
  await task(B.page, 'Edited on B later').waitFor()
})

await step('signing out keeps local data', async () => {
  const d = await openSettings(B.page)
  await d.getByRole('button', { name: 'Sign out' }).click()
  await d.getByRole('button', { name: 'Sign in (dev)' }).waitFor()
  await closeSettings(B.page)
  await B.page.reload()
  await task(B.page, 'Edited on B later').waitFor()
})

await browser.close()
server.kill()
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
