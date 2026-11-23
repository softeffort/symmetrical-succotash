// Contact sheet of the Core: node sheet.mjs <name> <json-config>
// config: { theme, w, h, dpr, quality, bare, clip:[x,y,w,h], cols, scale, cells:[{ label, set:{...}, js:'...', wait }] , reduce, gl, soft }
import { open, sleep } from './lib.mjs';
import sharp from 'sharp';
import fs from 'node:fs';

const name = process.argv[2];
const cfg = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const { browser, page, logs } = await open(cfg);
if (cfg.bare) await page.addStyleTag({ content: 'body>*:not(.core-scene){visibility:hidden!important}' });
if (cfg.quality) await page.evaluate((q) => Core.quality(q), cfg.quality);
await sleep(cfg.settle ?? 1200);
const clip = cfg.clip ? { x: cfg.clip[0], y: cfg.clip[1], width: cfg.clip[2], height: cfg.clip[3] } : undefined;
const shots = [];
for (const cell of cfg.cells) {
  if (cell.set) await page.evaluate((s) => { const o = Object.assign({}, s); if (typeof o.target === 'string') o.target = document.querySelector(o.target); Core.set(o); }, cell.set);
  if (cell.js) await page.evaluate(cell.js);
  await sleep(cell.wait ?? 2500);
  const buf = await page.screenshot({ clip, type: 'png' });
  shots.push({ buf, label: cell.label || '' });
  if (cell.after) await page.evaluate(cell.after);
}
const info = await page.evaluate(() => Core.info());
await browser.close();

const scale = cfg.scale ?? 1;
const meta = await sharp(shots[0].buf).metadata();
const cw = Math.round(meta.width * scale), ch = Math.round(meta.height * scale), cols = cfg.cols ?? Math.min(4, shots.length), rows = Math.ceil(shots.length / cols), pad = 22;
const comps = [];
for (let i = 0; i < shots.length; i++) {
  const x = (i % cols) * cw, y = Math.floor(i / cols) * (ch + pad);
  comps.push({ input: await sharp(shots[i].buf).resize(cw, ch).toBuffer(), left: x, top: y + pad });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${pad}"><rect width="100%" height="100%" fill="#222"/><text x="6" y="16" font-family="sans-serif" font-size="14" fill="#fff">${shots[i].label.replace(/[<&]/g, '')}</text></svg>`;
  comps.push({ input: Buffer.from(svg), left: x, top: y });
}
await sharp({ create: { width: cols * cw, height: rows * (ch + pad), channels: 3, background: '#444' } }).composite(comps).jpeg({ quality: 88 }).toFile(`shots/${name}.jpg`);
console.log(name, JSON.stringify(info), logs.join(' | ') || 'console clean');
