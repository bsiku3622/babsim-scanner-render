/* A small DevTools-protocol client for headless Chrome — enough to open a built deck,
 * step through its slides and photograph each one (the PowerPoint export).
 *
 * Chrome writes the port it picked to <profile>/DevToolsActivePort; we talk to the
 * browser over that WebSocket and drive one page through a flattened session.
 * The profile lives in node_modules/.cache and is reused, so nothing piles up. */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void }

export class Browser {
  private ws!: WebSocket
  private id = 0
  private pending = new Map<number, Pending>()
  private listeners: ((m: any) => void)[] = []
  private proc!: ReturnType<typeof Bun.spawn>
  private session = ''

  static async launch(chrome: string, profile: string): Promise<Browser> {
    const b = new Browser()
    mkdirSync(profile, { recursive: true })
    const portFile = join(profile, 'DevToolsActivePort')
    if (existsSync(portFile)) rmSync(portFile) // a stale one from an earlier run would point nowhere
    b.proc = Bun.spawn([chrome, '--headless=new', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1920,1080', 'about:blank'], { stdout: 'ignore', stderr: 'ignore' })
    const t0 = Date.now()
    while (!existsSync(portFile) || !readFileSync(portFile, 'utf8').includes('\n')) {
      if (Date.now() - t0 > 20000) { b.proc.kill(); throw new Error('headless Chrome이 시작되지 않았습니다.') }
      await Bun.sleep(50)
    }
    const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n')
    b.ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
    await new Promise<void>((res, rej) => { b.ws.onopen = () => res(); b.ws.onerror = () => rej(new Error('DevTools에 연결하지 못했습니다.')) })
    b.ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data))
      if (m.id && b.pending.has(m.id)) {
        const p = b.pending.get(m.id)!
        b.pending.delete(m.id)
        if (m.error) p.reject(new Error(m.error.message))
        else p.resolve(m.result)
      } else b.listeners.forEach((l) => l(m))
    }
    const { targetId } = await b.send('Target.createTarget', { url: 'about:blank' }, false)
    b.session = (await b.send('Target.attachToTarget', { targetId, flatten: true }, false)).sessionId
    return b
  }

  send(method: string, params: Record<string, unknown> = {}, onPage = true): Promise<any> {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params, ...(onPage ? { sessionId: this.session } : {}) }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  /** run an expression in the page and return its value (promises are awaited) */
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value as T
  }

  async open(url: string, width: number, height: number, scale: number) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
    await this.send('Page.enable')
    const loaded = new Promise<void>((res) => this.listeners.push((m) => { if (m.method === 'Page.loadEventFired') res() }))
    await this.send('Page.navigate', { url })
    await loaded
  }

  async until(expression: string, timeout = 60000) {
    const t0 = Date.now()
    while (!(await this.eval<boolean>(expression))) {
      if (Date.now() - t0 > timeout) throw new Error('덱이 제시간에 그려지지 않았습니다 (headless Chrome).')
      await Bun.sleep(100)
    }
  }

  /** a PNG of the viewport */
  async shot(): Promise<Buffer> {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    return Buffer.from(r.data, 'base64')
  }

  async close() {
    try { await Promise.race([this.send('Browser.close', {}, false), Bun.sleep(3000)]) } catch { /* already gone */ }
    try { this.ws.close() } catch { /* closed */ }
    const exited = await Promise.race([this.proc.exited.then(() => true), Bun.sleep(5000).then(() => false)])
    if (!exited) this.proc.kill()
  }
}

/** photograph every slide of a built deck: one PNG per slide, at `scale` × 1920×1080 */
export async function captureSlides(chrome: string, profile: string, file: string, scale = 1, onSlide?: (i: number, n: number) => void): Promise<Buffer[]> {
  const b = await Browser.launch(chrome, profile)
  try {
    await b.open(`file://${file}#1`, 1920, 1080, scale)
    await b.until(`document.body && document.body.dataset.ready === '1' && !!window.__esset`)
    await b.eval(`window.__esset.capture()`)
    const n = await b.eval<number>(`window.__esset.count()`)
    const shots: Buffer[] = []
    for (let i = 0; i < n; i++) {
      // two frames after the switch, and the thumbnails of any YouTube slide
      await b.eval(`window.__esset.show(${i}); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
      await b.eval(`Promise.all(Array.from(document.querySelectorAll('.slide.on .yt')).map((el) => new Promise((r) => {
        const m = /url\\(["']?([^"')]+)/.exec(el.style.backgroundImage); if (!m) return r(0)
        const im = new Image(); im.onload = im.onerror = () => r(0); im.src = m[1]; setTimeout(r, 4000) })))`)
      shots.push(await b.shot())
      onSlide?.(i, n)
    }
    return shots
  } finally {
    await b.close()
  }
}
