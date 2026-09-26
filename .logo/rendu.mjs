import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const p = await b.newPage({ viewport: { width: 1480, height: 620 }, deviceScaleFactor: 2 });
await p.goto(`file://${process.cwd()}/.logo/planche.html`, { waitUntil: 'networkidle' });
await p.screenshot({ path: '.logo/planche.png', fullPage: true });
await b.close();
