// node render-node.mjs <mode|probe> <spp> <out.png> <W> <H> <dpr> [query]
// Renders render.html in headless Chrome with the GPU on (the desktop's RTX), writes the PNG and the projected anchors.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
const dir = dirname(fileURLToPath(import.meta.url))
const [mode = 'raster', spp = '256', out = 'out.png', W = '1200', H = '1560', dpr = '1', extra = '', page = 'render.html'] = process.argv.slice(2)
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const types = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript' }
const srv = createServer((q, r) => { const p = join(dir, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!existsSync(p)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); r.end(readFileSync(p)) })
await new Promise((res) => srv.listen(0, '127.0.0.1', res))
const prof = mkdtempSync(join(tmpdir(), 'scanner-render-'))
const proc = spawn(CHROME, ['--headless=new', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--force_high_performance_gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--remote-debugging-port=0', `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
const portFile = join(prof, 'DevToolsActivePort'), t0 = Date.now()
while (!existsSync(portFile) || !readFileSync(portFile, 'utf8').includes('\n')) { if (Date.now() - t0 > 30000) throw new Error('chrome did not start'); await sleep(100) }
const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n')
const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0, session = ''; const pending = new Map(), listeners = []
ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result) } else listeners.forEach((l) => l(m)) }
const send = (method, params = {}, onPage = true) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params, ...(onPage ? { sessionId: session } : {}) })); return new Promise((res, rej) => pending.set(i, { res, rej })) }
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value }
const errs = []
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, false)
  session = (await send('Target.attachToTarget', { targetId, flatten: true }, false)).sessionId
  await send('Runtime.enable'); await send('Page.enable')
  listeners.push((m) => { if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text) })
  await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: +dpr, mobile: false })
  if (mode === 'probe') {
    console.log(await evaluate(`(() => { const g = document.createElement('canvas').getContext('webgl2'); if (!g) return 'no webgl2'; const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL) })()`))
  } else {
    // a WebGL context sometimes comes up lost on this dual-GPU machine: open the page again (up to 6 times)
    let tries = 0
    const go = async () => { errs.length = 0; const loaded = new Promise((res) => listeners.push((m) => { if (m.method === 'Page.loadEventFired') res() }))
      await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/${page}?mode=${mode}&spp=${spp}${extra ? '&' + extra : ''}&t=${tries}` }); await loaded }
    await go()
    let last = -1
    while (!(await evaluate('!!window.__done'))) {
      if (errs.length && errs.join(' ').includes('premultipliedAlpha') && ++tries < 6) { console.log('  context lost, retry', tries); await sleep(1500); await go(); continue }
      if (errs.length) throw new Error(errs.join('\n'))
      const p = await evaluate('window.__progress ?? -1'); if (p !== last && p % 40 === 0) { console.log(`  ${out} ${p} spp · ${((Date.now() - t0) / 1000).toFixed(0)} s`); last = p }
      if (Date.now() - t0 > 60 * 60000) throw new Error('timeout'); await sleep(1000)
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(dir, out), Buffer.from(shot.data, 'base64'))
    writeFileSync(join(dir, out.replace(/\.png$/, '.anchors.json')), JSON.stringify(await evaluate('window.__anchors'), null, 1))
    console.log('done', out, ((Date.now() - t0) / 1000).toFixed(1) + ' s')
  }
} finally {
  try { await Promise.race([send('Browser.close', {}, false), sleep(3000)]) } catch {}
  try { ws.close() } catch {}
  await Promise.race([new Promise((r) => proc.on('exit', r)), sleep(6000)]); try { proc.kill() } catch {}
  srv.close(); await sleep(500)
  rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
