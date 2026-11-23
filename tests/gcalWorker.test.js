import { describe, expect, it } from 'vitest'
import worker from '../worker/src/index.js'
import { GCAL_SCOPE, redirectOk } from '../worker/src/gcal.js'

const VERIFIER = 'v'.repeat(64)
const env = (fetcher, extra = {}) => ({ GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'shh', GCAL_FETCH: fetcher, ...extra })
const call = (path, body, e) => worker.fetch(new Request(`https://hiyori.test${path}`, { method: 'POST', body: JSON.stringify(body) }), e)
const google = (status, body, seen = []) => async (url, opts) => {
  seen.push({ url, form: Object.fromEntries(new URLSearchParams(opts.body)) })
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('Worker：Google 日曆的授權（/v1/gcal/*）', () => {
  it('沒設用戶端：回 gcal off；設了：給用戶端 ID 和只管 App 自己日曆的權限', async () => {
    const off = await call('/v1/gcal/config', {}, {})
    expect(off.status).toBe(503)
    expect(await off.json()).toEqual({ error: 'gcal off' })
    const on = await call('/v1/gcal/config', {}, env(google(200, {})))
    expect(await on.json()).toEqual({ ok: true, clientId: 'cid.apps.googleusercontent.com', scope: GCAL_SCOPE })
    expect(on.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
  it('授權碼換 token：帶 secret、verifier、redirect 給 Google；回 refresh 和 access', async () => {
    const seen = []
    const r = await call('/v1/gcal/token', { code: 'c1', verifier: VERIFIER, redirect: 'https://me.github.io/hiyori-island/' }, env(google(200, { access_token: 'a1', expires_in: 3599, refresh_token: 'r1', scope: GCAL_SCOPE }, seen)))
    expect(await r.json()).toEqual({ ok: true, access: 'a1', expires: 3599, refresh: 'r1' })
    expect(seen[0].url).toBe('https://oauth2.googleapis.com/token')
    expect(seen[0].form).toEqual({ code: 'c1', code_verifier: VERIFIER, redirect_uri: 'https://me.github.io/hiyori-island/', client_id: 'cid.apps.googleusercontent.com', client_secret: 'shh', grant_type: 'authorization_code' })
  })
  it('沒勾管理日曆的權限、Google 沒給 refresh token、授權碼不能用：各回看得懂的錯', async () => {
    const body = { code: 'c1', verifier: VERIFIER, redirect: 'https://me.github.io/' }
    const scope = await call('/v1/gcal/token', body, env(google(200, { access_token: 'a', refresh_token: 'r', scope: 'openid' })))
    expect([scope.status, (await scope.json()).error]).toEqual([403, 'gcal scope'])
    const norefresh = await call('/v1/gcal/token', body, env(google(200, { access_token: 'a', scope: GCAL_SCOPE })))
    expect((await norefresh.json()).error).toBe('gcal no refresh')
    const bad = await call('/v1/gcal/token', body, env(google(400, { error: 'invalid_grant' })))
    expect([bad.status, (await bad.json()).error]).toEqual([401, 'gcal expired'])
    const client = await call('/v1/gcal/token', body, env(google(401, { error: 'invalid_client' })))
    expect((await client.json()).error).toBe('gcal client')
  })
  it('請求不對的不送去 Google：verifier 太短、redirect 不是 https（本機開發的 localhost 可以）', async () => {
    const seen = []
    const e = env(google(200, {}, seen))
    for (const b of [{ code: 'c', verifier: 'short', redirect: 'https://a.io/' }, { code: 'c', verifier: VERIFIER, redirect: 'http://evil.example/' }, { verifier: VERIFIER, redirect: 'https://a.io/' }]) {
      expect((await call('/v1/gcal/token', b, e)).status).toBe(400)
    }
    expect(seen).toEqual([])
    expect(redirectOk('http://localhost:5300/')).toBe(true)
    expect(redirectOk('http://127.0.0.1:5311/')).toBe(true)
    expect(redirectOk('https://a.io/#x')).toBe(false)
    expect(redirectOk('https://a.io/?next=evil')).toBe(false)
    expect(redirectOk('javascript:alert(1)')).toBe(false)
  })
  it('refresh token 換 access token；過期、被撤銷的回 gcal expired', async () => {
    const seen = []
    const r = await call('/v1/gcal/refresh', { refresh: 'r1' }, env(google(200, { access_token: 'a2', expires_in: 3600 }, seen)))
    expect(await r.json()).toEqual({ ok: true, access: 'a2', expires: 3600 })
    expect(seen[0].form).toMatchObject({ refresh_token: 'r1', grant_type: 'refresh_token', client_secret: 'shh' })
    const gone = await call('/v1/gcal/refresh', { refresh: 'r1' }, env(google(400, { error: 'invalid_grant' })))
    expect([gone.status, (await gone.json()).error]).toEqual([401, 'gcal expired'])
    expect((await call('/v1/gcal/refresh', {}, env(google(200, {})))).status).toBe(400)
  })
  it('撤銷：請 Google 撤銷；已經失效的（400）也算撤銷好了；連不上 Google 回 502', async () => {
    const seen = []
    expect(await (await call('/v1/gcal/revoke', { token: 'r1' }, env(google(200, {}, seen)))).json()).toEqual({ ok: true })
    expect(seen[0]).toEqual({ url: 'https://oauth2.googleapis.com/revoke', form: { token: 'r1' } })
    expect((await call('/v1/gcal/revoke', { token: 'r1' }, env(google(400, { error: 'invalid_token' })))).status).toBe(200)
    const down = await call('/v1/gcal/revoke', { token: 'r1' }, env(async () => Promise.reject(new Error('down'))))
    expect([down.status, (await down.json()).error]).toEqual([502, 'google unreachable'])
  })
})
