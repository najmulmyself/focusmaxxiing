// End-to-end checks for the timer's durability guarantees, driven by Playwright
// with a faked clock. Starts its own Vite dev server.  Run: npm run e2e
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { chromium } = createRequire(import.meta.url)('playwright')
const MIN = 60_000
const T0 = new Date('2026-10-26T09:00:00').getTime()

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' })
await server.listen()
const URL = 'http://localhost:5199/#/'
const browser = await chromium.launch()
let failed = 0

// Warm up: Vite optimises dependencies on the first page load and reloads the page,
// which would otherwise land in the middle of the first test.
{
  const warm = await browser.newPage()
  await warm.goto(URL)
  await warm.getByRole('timer').waitFor()
  await warm.waitForTimeout(1500)
  await warm.close()
}

async function test(name, fn) {
  const context = await browser.newContext()
  try {
    await fn(context)
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    if (process.env.E2E_SHOTS) for (const [i, pg] of context.pages().entries()) await pg.screenshot({ path: `${process.env.E2E_SHOTS}/fail-${name.slice(0, 20).replace(/\W+/g, '-')}-${i}.png` }).catch(() => {})
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

async function addTask(page, title, est = 1, project = null) {
  await page.getByRole('button', { name: '+ Add task' }).click()
  await page.getByPlaceholder('What are you working on?').fill(title)
  for (let i = 1; i < est; i++) await page.getByRole('button', { name: 'One more' }).click()
  if (project) {
    await page.locator('select[id^=proj-]').selectOption('__new__')
    await page.getByPlaceholder('Project name').fill(project)
  }
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: `Work on “${title}”` }).waitFor()
}

/** Poll until a locator's text matches (UI updates from IndexedDB are async). */
async function waitText(locator, re, timeout = 3000) {
  const end = Date.now() + timeout
  let last = ''
  while (Date.now() < end) {
    last = await locator.innerText().catch(() => '')
    if (re.test(last)) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Expected ${re} in: ${JSON.stringify(last)}`)
}

const dbAll = (page, store) =>
  page.evaluate(
    (store) =>
      new Promise((res) => {
        const r = indexedDB.open('focusmaxxiing')
        r.onsuccess = () => {
          const q = r.result.transaction(store).objectStore(store).getAll()
          q.onsuccess = () => res(q.result)
        }
      }),
    store,
  )

await test('tasks: credit a pomodoro, reflect, and finish the task', async (ctx) => {
  const page = await open(ctx)
  await addTask(page, 'Write the onboarding copy', 3, 'Writing')
  await addTask(page, 'Inbox to zero')
  // first task added is auto-selected
  assert.match(await page.getByText(/^#1 ·/).innerText(), /Write the onboarding copy/i)
  assert.match(await page.locator('#tasks-h').locator('..').locator('..').innerText(), /Finish at\s+10:55/i) // 4 pomodoros + 3 short breaks from 09:00
  await page.getByRole('button', { name: 'Start' }).click()
  await page.clock.fastForward(25 * MIN + 1000)
  await page.getByLabel(/What did you get done/).fill('Drafted the welcome screen')
  await page.getByRole('radio', { name: '4 of 5: Focused' }).click()
  await page.getByLabel('Task finished').check()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('checkbox', { name: /Mark “Write the onboarding copy” not done/ }).waitFor()
  const [s] = await dbAll(page, 'sessions')
  assert.equal(s.note, 'Drafted the welcome screen')
  assert.equal(s.quality, 4)
  assert.equal(s.revision, 2)
  const tasks = await dbAll(page, 'tasks')
  const projects = await dbAll(page, 'projects')
  const task = tasks.find((t) => t.title === 'Write the onboarding copy')
  assert.equal(s.taskId, task.id)
  assert.equal(s.projectId, projects[0].id)
  assert.equal(projects[0].name, 'Writing')
  assert.match(await page.getByRole('button', { name: 'Work on “Write the onboarding copy”' }).locator('..').innerText(), /1\/3/)
})

await test('tasks: delete with undo, and templates', async (ctx) => {
  const page = await open(ctx)
  await addTask(page, 'Standup', 1)
  await addTask(page, 'Deep work block', 4)
  await page.getByRole('button', { name: 'Edit “Standup”' }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.getByRole('button', { name: 'Work on “Standup”' }).waitFor()
  await page.getByRole('button', { name: 'Task list options' }).click()
  await page.getByRole('button', { name: 'Save list as template…' }).click()
  await page.getByLabel('Template name').fill('Workday')
  await page.keyboard.press('Enter')
  await page.getByText('Saved template “Workday”.').waitFor()
  await page.getByRole('button', { name: 'Task list options' }).click()
  await page.getByRole('button', { name: 'Clear all tasks…' }).click()
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await page.getByRole('button', { name: 'Task list options' }).click()
  await page.getByRole('button', { name: /^Workday/ }).click()
  await page.getByRole('button', { name: 'Work on “Deep work block”' }).waitFor()
  assert.equal((await dbAll(page, 'tasks')).filter((t) => !t.deletedAt).length, 2)
})

await test('tasks: drag to reorder, and the order survives a reload', async (ctx) => {
  const page = await open(ctx)
  for (const title of ['First', 'Second', 'Third']) await addTask(page, title)
  const row = (title) => page.getByRole('button', { name: `Work on “${title}”` }).locator('..')
  await row('Third').dragTo(row('First'))
  const titles = async () => (await page.getByRole('button', { name: /^Work on/ }).allInnerTexts()).map((x) => x.trim())
  assert.deepEqual(await titles(), ['Third', 'First', 'Second'])
  await page.reload()
  await page.getByRole('button', { name: 'Work on “Third”' }).waitFor()
  assert.deepEqual(await titles(), ['Third', 'First', 'Second'])
})

await test('reports: real sessions, manual entry, edit, delete with undo', async (ctx) => {
  const page = await open(ctx)
  await addTask(page, 'Write the onboarding copy', 2, 'Writing')
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Start' }).click()
    await page.clock.fastForward(25 * MIN + 1000)
    await page.getByRole('button', { name: 'Skip', exact: true }).click() // dismiss reflection
    await page.keyboard.press('1')
  }
  await page.getByRole('link', { name: 'Reports' }).click()
  await page.getByRole('heading', { name: 'Reports' }).waitFor()
  const tile = (k) => page.getByText(k, { exact: true }).locator('..')
  assert.match(await tile('Focus time').innerText(), /50m/)
  assert.match(await tile('Pomodoros').innerText(), /\b2\b/)
  assert.match(await tile('Streak').innerText(), /1 day/)

  // log a forgotten session by hand
  await page.getByRole('button', { name: '+ Add session' }).click()
  await page.getByLabel('Start').fill('08:00')
  await page.getByLabel('Minutes focused').fill('40')
  await page.getByLabel('Note').fill('Morning pages')
  await page.getByRole('button', { name: 'Add session', exact: true }).click()
  await page.getByRole('cell', { name: 'Morning pages' }).waitFor()
  await waitText(tile('Focus time'), /1h 30m/)

  // edit it
  await page.getByRole('row', { name: /Morning pages/ }).getByRole('button', { name: /^Edit session/ }).click()
  await page.getByLabel('Note').fill('Morning pages, edited')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('cell', { name: 'Morning pages, edited' }).waitFor()

  // delete, then undo
  await page.getByRole('row', { name: /Morning pages, edited/ }).getByRole('button', { name: /^Edit session/ }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete' }).last().click()
  await page.getByText('Session deleted.').waitFor()
  await waitText(tile('Focus time'), /\n50m/)
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.getByRole('cell', { name: 'Morning pages, edited' }).waitFor()
  const rows = await dbAll(page, 'sessions')
  const manual = rows.find((r) => r.note === 'Morning pages, edited')
  assert.equal(manual.revision, 4) // created, edited, deleted, restored
  assert.equal(manual.deletedAt, null)
})

await test('reports: sample data loads and removes cleanly, leaving real data', async (ctx) => {
  const page = await open(ctx)
  await page.goto(URL.replace('#/', '#/reports'))
  await page.getByRole('button', { name: 'Explore with sample data' }).click()
  await page.getByText('You’re looking at sample data.').waitFor()
  assert.ok((await dbAll(page, 'sessions')).length > 200)
  // a real session logged while samples are loaded
  await page.getByRole('button', { name: '+ Add session' }).click()
  await page.getByLabel('Note').fill('Real work')
  await page.getByRole('button', { name: 'Add session', exact: true }).click()
  await page.getByRole('button', { name: 'Remove sample data' }).click()
  await page.getByText('You’re looking at sample data.').waitFor({ state: 'detached' })
  const left = await dbAll(page, 'sessions')
  assert.equal(left.length, 1)
  assert.equal(left[0].note, 'Real work')
  assert.equal((await dbAll(page, 'projects')).length, 0)
})

const snapshotDB = (page) =>
  page.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open('focusmaxxiing')
      r.onsuccess = () => res(r.result)
    })
    const all = (store) =>
      new Promise((res) => {
        const q = db.transaction(store).objectStore(store).getAll()
        q.onsuccess = () => res(q.result.sort((a, b) => a.id.localeCompare(b.id)))
      })
    const out = {}
    for (const s of ['sessions', 'tasks', 'projects', 'templates']) out[s] = await all(s)
    db.close()
    return out
  })

await test('backup: export → wipe → restore gives identical data', async (ctx) => {
  const page = await open(ctx)
  await page.goto(URL.replace('#/', '#/reports'))
  await page.getByRole('button', { name: 'Explore with sample data' }).click()
  await page.getByText('Focus by day').waitFor()
  // a real session on top of the samples, with characters CSV has to escape
  await page.getByRole('button', { name: '+ Add session' }).click()
  await page.getByLabel('Note').fill('Real, with "quotes"')
  await page.getByRole('button', { name: 'Add session', exact: true }).click()
  await page.getByRole('cell', { name: 'Real, with "quotes"' }).waitFor()
  const before = await snapshotDB(page)
  assert.ok(before.sessions.length > 200)

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup', exact: true }).click()])
  assert.match(dl.suggestedFilename(), /^focusmaxxiing-backup-\d{4}-\d{2}-\d{2}\.json$/)
  const dir = await mkdtemp(join(tmpdir(), 'fm-'))
  const file = join(dir, dl.suggestedFilename())
  await dl.saveAs(file)
  await page.getByText(/Last backup: today/).waitFor()

  // CSV: one row per live session plus a header
  await page.getByRole('radio', { name: 'All time' }).click()
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Sessions (.csv)' }).click()])
  const csvText = await readFile(await csv.path(), 'utf8')
  assert.equal(csvText.trim().split('\r\n').length, before.sessions.filter((s) => !s.deletedAt).length + 1)
  assert.ok(csvText.includes('"Real, with ""quotes"""'))

  // wipe this browser completely
  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise((r) => {
      const q = indexedDB.deleteDatabase('focusmaxxiing')
      q.onsuccess = q.onerror = q.onblocked = r
    })
  })
  await page.reload()
  await page.getByText('Nothing to report yet').waitFor()

  // restore through Settings on the timer screen
  await page.goto(URL)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel(/Choose a .json file/).setInputFiles(file)
  await page.getByRole('button', { name: 'Merge backup' }).click()
  await page.getByText('Restored.').waitFor()
  assert.deepEqual(await snapshotDB(page), before)
})

await test('backup: a file that is not a backup is refused and changes nothing', async (ctx) => {
  const page = await open(ctx)
  await addTask(page, 'Keep me')
  const dir = await mkdtemp(join(tmpdir(), 'fm-'))
  const file = join(dir, 'notes.json')
  await writeFile(file, JSON.stringify({ hello: 'world' }))
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel(/Choose a .json file/).setInputFiles(file)
  await page.getByRole('radio', { name: /Replace/ }).check()
  assert.equal(await page.getByRole('button', { name: 'Replace with backup' }).isDisabled(), true)
  await page.getByLabel('I understand this replaces all data in this browser.').check()
  await page.getByRole('button', { name: 'Replace with backup' }).click()
  await page.getByText(/Nothing was imported\. This isn.t a focusmaxxiing backup/).waitFor()
  assert.equal((await dbAll(page, 'tasks')).length, 1)
})

await browser.close()
await server.close()
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
