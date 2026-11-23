import puppeteer from 'puppeteer-core';
export const BASE = 'http://127.0.0.1:3111/core/showcase.html';
// soft=true: allow software WebGL (the engine refuses it on purpose); gl=false: no WebGL at all
export async function open({ w = 1440, h = 900, dpr = 1, theme = 'dark', soft = true, gl = true, reduce = false, query = '', cpu = 1, touch = false } = {}) {
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
  if (cpu > 1) { const c = await page.createCDPSession(); await c.send('Emulation.setCPUThrottlingRate', { rate: cpu }); }
  await page.goto(BASE + '?theme=' + theme + (query ? '&' + query : ''), { waitUntil: 'load' });
  await page.waitForFunction(() => window.Core && Core.info().mode !== 'boot', { timeout: 20000 }).catch(() => {});
  return { browser, page, logs };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
