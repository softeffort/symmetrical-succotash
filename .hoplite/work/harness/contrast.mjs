// Real-browser contrast: a full-screen glass pane of each depth over the Core; worst background pixel vs each text colour.
// node contrast.mjs <theme> [w h]
import { open, step, settle, lum, ratio } from './lib.mjs';
import sharp from 'sharp';
const theme = process.argv[2] || 'dark', w = +process.argv[3] || 1440, h = +process.argv[4] || 900;
const { browser, page, logs } = await open({ theme, w, h, virtual: true });
await page.addStyleTag({ content: 'body>*:not(.core-scene):not(#probe){visibility:hidden!important} #probe{position:fixed;inset:-60px;z-index:9;border-radius:0}' });
await page.evaluate(() => { const d = document.createElement('div'); d.id = 'probe'; document.body.appendChild(d); Core.quality('high'); });
const texts = await page.evaluate(() => ['--core-text', '--core-text-2', '--core-text-3'].map((n) => { const s = document.createElement('span'); s.style.color = 'var(' + n + ')'; document.body.appendChild(s); const c = getComputedStyle(s).color.match(/[\d.]+/g).map(Number); s.remove(); return c; }));
const tl = texts.map((c) => lum(c[0], c[1], c[2]));
async function worst(depth) {
  await page.evaluate((d) => { document.getElementById('probe').className = d ? 'core-glass core-glass--' + d : ''; }, depth);
  await settle(page);
  const { data, info } = await sharp(await page.screenshot({ type: 'png' })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let ext = theme === 'dark' ? 0 : 1, px = null;
  for (let i = 0; i < data.length; i += 3) { const l = lum(data[i], data[i + 1], data[i + 2]); if (theme === 'dark' ? l > ext : l < ext) { ext = l; px = [data[i], data[i + 1], data[i + 2], (i / 3) % info.width, Math.floor(i / 3 / info.width)]; } }
  return { ext, px };
}
const depths = ['far', 'mid', 'near', 'dense'];
const scen = [
  ['center rest sphere', { place: 'center', state: 'rest', form: 'sphere' }, 3000, null],
  ['center thinking sphere', { place: 'center', state: 'thinking', form: 'sphere' }, 4000, null],
  ['center thinking+flash', { place: 'center', state: 'thinking', form: 'sphere' }, 500, 'flash'],
  ['center rest+flash', { place: 'center', state: 'rest', form: 'sphere' }, 3000, 'flash'],
  ['center answering', { place: 'center', state: 'answering', form: 'sphere' }, 3000, null],
  ['horizon thinking+flash', { place: 'horizon', state: 'thinking', form: 'sphere' }, 3000, 'flash'],
  ['horizon answering', { place: 'horizon', state: 'answering', form: 'sphere' }, 3000, null],
  ['full rest+flash', { place: 'full', state: 'rest', form: 'sphere' }, 3000, 'flash'],
  ['center knot thinking+flash', { place: 'center', state: 'thinking', form: 'knot' }, 4000, 'flash'],
  ['center lattice rest+flash', { place: 'center', state: 'rest', form: 'lattice' }, 4000, 'flash'],
  ['center torus listening', { place: 'center', state: 'listening', form: 'torus' }, 4000, null],
];
let floor = 99;
for (const [label, set, wait, pulse] of scen) {
  await page.evaluate((s) => Core.set(s), set);
  await step(page, wait);
  if (pulse) { await page.evaluate((p) => Core.pulse(p), pulse); await step(page, 100); }
  const row = [];
  for (const d of depths) {
    const { ext, px } = await worst(d);
    const rs = tl.map((t) => ratio(t, ext));
    floor = Math.min(floor, ...rs);
    row.push(d + ' ' + rs.map((r) => r.toFixed(2)).join('/') + ' @' + px.slice(0, 3).join(','));
  }
  console.log(label.padEnd(28), row.join('  |  '));
}
console.log('theme', theme, w + 'x' + h, 'text/text-2/text-3; lowest ratio', floor.toFixed(2), logs.join(' | '));
await browser.close();
