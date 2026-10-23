// Headless play-through. Serves the repo, starts the game, plays a little, and reports page errors.
// Usage: node tests/smoke.js   (needs Playwright with Chromium; screenshots go to tests/out/)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const PORT = process.env.PORT || '8765';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = spawn('python3', ['-m', 'http.server', PORT, '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  let code = 0;
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, hasTouch: true });
    const problems = [];
    page.on('pageerror', e => problems.push('PAGEERROR ' + e.message));
    page.on('console', m => { if (m.type() === 'error') problems.push('CONSOLE error ' + m.text()); });

    await page.goto(`http://127.0.0.1:${PORT}/index.html`);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, 'title.png') });
    console.log('title state:', await page.evaluate(() => window.Game && Game.state));

    await page.mouse.click(700, 270);            // start
    await page.waitForTimeout(2500);
    await page.mouse.move(200, 300); await page.mouse.down();   // drag the ship on the left
    for (let i = 0; i < 40; i++) { await page.mouse.move(200 + i * 3, 300 - i * 2); await page.waitForTimeout(40); }
    await page.mouse.up();
    await page.touchscreen.tap(800, 300);
    await page.waitForTimeout(3000);
    await page.keyboard.down('Space');           // autofire
    await page.waitForTimeout(4000);
    await page.keyboard.up('Space');
    await page.screenshot({ path: path.join(OUT, 'play.png') });
    console.log('play state:', await page.evaluate(() => window.Game && Game.state));

    const fps = await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now();
      (function f() { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); })(); }));
    console.log('approx fps:', fps);

    if (problems.length) { console.log('problems:\n  ' + problems.join('\n  ')); code = 1; }
    else console.log('no page errors');
    await browser.close();
  } catch (e) {
    console.error('smoke test failed to run:', e.message);
    code = 2;
  } finally {
    srv.kill();
  }
  process.exit(code);
})();
