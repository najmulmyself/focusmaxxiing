import { handle } from '../../server/app'
import type { Env } from '../../server/d1'

// Cloudflare Pages Function: every /api/* request lands here.
export const onRequest = (ctx: { request: Request; env: Env }) => handle(ctx.request, ctx.env)
