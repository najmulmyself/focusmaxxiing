// End-to-end checks for the timer's durability guarantees, driven by Playwright
// with a faked clock. Starts its own Vite dev server.  Run: npm run e2e
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import assert from 'node:assert/strict'

const { chromium } = createRequire(import.meta.url)('playwright')
const MIN = 60_000
const T0 = new Date('2026-10-26T09:00:00').getTime()

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' })
await server.listen()
const URL = 'http://localhost:5199/#/'
const browser = await chromium.launch()
let failed = 0

async function test(name, fn) {
  const context = await browser.newContext()
  try {
    await fn(context)
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    console.log(`  ✗ ${name}\n    ${e.message.split('\n').join('\n    ')}`)
  } finally {
    await context.close()
  }
}

async function open(context, at = T0) {
  const page = await context.newPage()
  await page.clock.install({ time: at })
  await page.goto(URL)
  await page.getByRole('timer').waitFor()
  return page
}
const clock = (page) => page.getByRole('timer').innerText()
const settle = (page) => page.waitForTimeout(400) // let the worker tick land

await test('counts down and survives a reload mid-session', async (ctx) => {
  const page = await open(ctx)
  assert.equal(await clock(page), '25:00')
  await page.getByRole('button', { name: 'Start' }).click()
  await page.clock.fastForward(10 * MIN)
  await settle(page)
  assert.equal(await clock(page), '15:00')
  await page.reload()
  await page.getByRole('timer').waitFor()
  await settle(page)
  assert.equal(await clock(page), '15:00')
  await page.getByRole('button', { name: 'Pause' }).waitFor()
})

await test('pausing freezes time, also across reloads', async (ctx) => {
  const page = await open(ctx)
  await page.keyboard.press('Space')
  await page.clock.fastForward(5 * MIN)
  await settle(page)
  await page.keyboard.press('Space')
  await page.clock.fastForward(30 * MIN)
  await page.reload()
  await page.getByRole('timer').waitFor()
  await settle(page)
  assert.equal(await clock(page), '20:00')
  await page.getByRole('button', { name: 'Resume' }).waitFor()
})

await test('completes, logs the session and moves to a break', async (ctx) => {
  const page = await open(ctx)
  await page.getByRole('button', { name: 'Start' }).click()
  await page.clock.fastForward(25 * MIN + 1000)
  await settle(page)
  assert.equal(await clock(page), '05:00')
  assert.equal(await page.getByRole('tab', { selected: true }).innerText(), 'Short break')
  await page.getByText('Focus', { exact: true }).last().waitFor()
  assert.match(await page.locator('#today-h').locator('..').innerText(), /1\s*pomodoros/i)
})

await test('a session that ends while the app is closed is still logged, with its true end time', async (ctx) => {
  let page = await open(ctx)
  await page.getByRole('button', { name: 'Start' }).click()
  await page.clock.fastForward(MIN)
  await page.close()
  page = await open(ctx, T0 + 90 * MIN)
  await page.getByText(/finished while you were away/).waitFor({ timeout: 5000 })
  assert.equal(await page.getByRole('tab', { selected: true }).innerText(), 'Short break')
  const rows = await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('focusmaxxiing')
        r.onsuccess = () => {
          const q = r.result.transaction('sessions').objectStore('sessions').getAll()
          q.onsuccess = () => res(q.result)
        }
      }),
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'completed')
  assert.equal(rows[0].endedAt - rows[0].startedAt, 25 * MIN)
})

await test('resetting a real session asks first, then logs it as unfinished', async (ctx) => {
  const page = await open(ctx)
  await page.getByRole('button', { name: 'Start' }).click()
  await page.clock.fastForward(8 * MIN)
  await settle(page)
  await page.keyboard.press('r')
  await page.getByRole('dialog', { name: 'End this focus?' }).waitFor()
  await page.getByRole('button', { name: 'Keep going' }).click()
  assert.equal(await clock(page), '17:00')
  await page.getByRole('button', { name: 'Reset' }).click()
  await page.getByRole('button', { name: 'End session' }).click()
  await settle(page)
  assert.equal(await clock(page), '25:00')
  await page.getByText('unfinished', { exact: true }).waitFor()
  await page.getByText('Logged 8 minutes as an unfinished focus.').waitFor()
})

await test('shortcuts switch modes', async (ctx) => {
  const page = await open(ctx)
  await page.keyboard.press('3')
  assert.equal(await clock(page), '15:00')
  await page.keyboard.press('2')
  assert.equal(await clock(page), '05:00')
  await page.keyboard.press('?')
  await page.getByRole('dialog', { name: 'Shortcuts' }).waitFor()
})

await test('settings change durations and persist', async (ctx) => {
  const page = await open(ctx)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Focus', { exact: true }).fill('50')
  await page.keyboard.press('Escape')
  assert.equal(await clock(page), '50:00')
  await page.reload()
  await page.getByRole('timer').waitFor()
  assert.equal(await clock(page), '50:00')
})

await test('a second tab mirrors the running timer', async (ctx) => {
  const a = await open(ctx)
  const b = await open(ctx)
  await a.getByRole('button', { name: 'Start' }).click()
  await b.getByRole('button', { name: 'Pause' }).waitFor({ timeout: 3000 })
})

await browser.close()
await server.close()
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
