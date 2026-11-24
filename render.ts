// bun render.ts <mode> <spp> <out.png> [W H dpr] [extra query] — renders render.html in a GPU headless Chrome, writes PNG + anchors JSON
import { Browser } from './gpu-cdp.ts'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const [mode = 'raster', spp = '256', out = 'preview.png', W = '1270', H = '1000', dpr = '1', extra = ''] = process.argv.slice(2)
const dir = import.meta.dir
const srv = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: (r) => { const p = new URL(r.url).pathname; return new Response(Bun.file(join(dir, decodeURIComponent(p)))) } })
const prof = mkdtempSync(join(tmpdir(), 'scanner-render-'))
const b = await Browser.launch('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', prof)
const t0 = Date.now()
try {
  await b.send('Runtime.enable')
  const errs: string[] = []
  ;(b as any).listeners.push((m: any) => { if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map((a: any) => a.value ?? a.description).join(' ')) })
  await b.open(`http://127.0.0.1:${srv.port}/render.html?mode=${mode}&spp=${spp}${extra ? '&' + extra : ''}`, +W, +H, +dpr)
  let last = -1
  while (!(await b.eval<boolean>('!!window.__done'))) {
    if (errs.length) throw new Error(errs.join('\n'))
    const p = await b.eval<number>('window.__progress ?? -1')
    if (p !== last && p % 32 === 0) { console.log(`  ${p} spp · ${((Date.now() - t0) / 1000).toFixed(0)} s`); last = p }
    if (Date.now() - t0 > 40 * 60000) throw new Error('timeout')
    await Bun.sleep(500)
  }
  writeFileSync(join(dir, out), await b.shot())
  writeFileSync(join(dir, out.replace(/\.png$/, '.anchors.json')), JSON.stringify(await b.eval('window.__anchors'), null, 1))
  console.log('done', out, ((Date.now() - t0) / 1000).toFixed(1) + ' s')
} finally {
  await b.close(); srv.stop(true)
  rmSync(prof, { recursive: true, force: true })
}
