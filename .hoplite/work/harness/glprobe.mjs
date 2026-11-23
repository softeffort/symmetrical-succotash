import puppeteer from 'puppeteer-core';
const variants = {
  swiftshader: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl'],
  swangle: ['--use-gl=angle','--use-angle=swiftshader-webgl','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],
  plain: [],
};
for (const [name, flags] of Object.entries(variants)) {
  let b;
  try {
    b = await puppeteer.launch({ executablePath: '/usr/local/bin/google-chrome', headless: 'new', args: ['--no-sandbox', ...flags] });
    const p = await b.newPage();
    await p.goto('about:blank');
    const r = await p.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl');
      if (!gl) return { webgl: false };
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return { webgl: true, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), maxPoint: Array.from(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)), lose: !!gl.getExtension('WEBGL_lose_context'), webgl2: !!document.createElement('canvas').getContext('webgl2') };
    });
    console.log(name, JSON.stringify(r));
  } catch (e) { console.log(name, 'ERR', String(e).slice(0, 200)); }
  finally { if (b) await b.close(); }
}
