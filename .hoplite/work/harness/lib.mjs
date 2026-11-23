import puppeteer from 'puppeteer-core';
export const BASE = 'http://127.0.0.1:3111/core/showcase.html';
// soft=true: allow software WebGL (the engine refuses it on purpose); gl=false: no WebGL at all
// virtual=true: the page clock, requestAnimationFrame and setTimeout move only when step(page, ms) is called
export async function open({ w = 1440, h = 900, dpr = 1, theme = 'dark', soft = true, gl = true, reduce = false, query = '', cpu = 1, touch = false, virtual = false, url = BASE } = {}) {
  const args = ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'];
  if (!gl) args.push('--disable-gpu', '--disable-3d-apis');
  const browser = await puppeteer.launch({ executablePath: '/usr/local/bin/google-chrome', headless: 'new', args });
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
  if (reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  if (soft) await page.evaluateOnNewDocument(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, o) {
      if (o && /webgl/.test(kind)) o = Object.assign({}, o, { failIfMajorPerformanceCaveat: false });
      return orig.call(this, kind, o);
    };
  });
  if (virtual) await page.evaluateOnNewDocument(() => {
    let now = 1000, seq = 0;
    const rafs = new Map(), timers = new Map(), t0 = 1700000000000;
    performance.now = () => now;
    Date.now = () => t0 + now;
    window.requestAnimationFrame = (f) => { rafs.set(++seq, f); return seq; };
    window.cancelAnimationFrame = (id) => { rafs.delete(id); };
    window.setTimeout = (f, ms, ...a) => { timers.set(++seq, { at: now + (ms || 0), f, a }); return seq; };
    window.clearTimeout = (id) => { timers.delete(id); };
    window.__step = (ms) => {
      now += ms;
      for (const [id, t] of [...timers]) if (t.at <= now && timers.has(id)) { timers.delete(id); try { t.f(...t.a); } catch (e) { console.error(e); } }
      const q = [...rafs]; rafs.clear();
      for (const [, f] of q) try { f(now); } catch (e) { console.error(e); }
      return now;
    };
  });
  if (cpu > 1) { const c = await page.createCDPSession(); await c.send('Emulation.setCPUThrottlingRate', { rate: cpu }); }
  await page.goto(url + '?theme=' + theme + (query ? '&' + query : ''), { waitUntil: 'load' });
  if (virtual) {
    for (let i = 0; i < 200; i++) { await step(page, 100, 16); if (await page.evaluate(() => window.Core && Core.info().mode !== 'boot')) break; await sleep(50); }
  } else await page.waitForFunction(() => window.Core && Core.info().mode !== 'boot', { timeout: 20000 }).catch(() => {});
  return { browser, page, logs };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// advance the virtual clock by ms in frames of `frame` ms
export async function step(page, ms, frame = 1000 / 60) {
  await page.evaluate((ms, frame) => { for (let t = 0; t < ms - 0.001; t += frame) window.__step(Math.min(frame, ms - t)); }, ms, frame);
}
// let the compositor present the last drawn frame
export async function settle(page) { await page.evaluate(() => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); })); await sleep(120); }
export function lum(r, g, b) { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
export function ratio(a, b) { const hi = Math.max(a, b), lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05); }
