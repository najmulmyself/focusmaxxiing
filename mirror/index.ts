import { mirror, type MirrorEnv } from '../server/mirror'

// Cloudflare Worker on a cron trigger: copies the owner's history to Google Sheets.
// Throwing marks the run as failed in the Cloudflare dashboard, with the reason in the logs.
export default {
  async scheduled(_controller: ScheduledController, env: MirrorEnv) {
    console.log(JSON.stringify(await mirror(env)))
  },
}
