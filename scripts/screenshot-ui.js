require('dotenv').config();

/**
 * 前端视觉验证截图（scripts/screenshot-ui.js，Phase9）
 *
 * 背景：crawl4ai 容器 SSRF 保护无法访问 localhost（实测 `URL blocked (SSRF protection)`），
 * 前端视觉验证改走本脚本（devDependency playwright-core，浏览器已装
 * C:\Users\asus\AppData\Local\ms-playwright；找不到时设 PLAYWRIGHT_BROWSERS_PATH）。
 *
 * 用法：
 *   node scripts/screenshot-ui.js                                # 默认抓 localhost:5173 → ./ui-screenshot.png
 *   node scripts/screenshot-ui.js --url http://localhost:5173 --out /tmp/ui.png --wait 3500
 *   node scripts/screenshot-ui.js --width 1440 --height 900
 */

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};

const url = flag('--url', process.env.UI_URL || 'http://localhost:5173');
const out = flag('--out', path.join(process.cwd(), 'ui-screenshot.png'));
const wait = Number(flag('--wait', '3500'));
const width = Number(flag('--width', '1440'));
const height = Number(flag('--height', '900'));
const fullPage = !args.includes('--no-fullpage');

(async () => {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('console', msg => { if (msg.type() === 'error') console.log('  [console.error]', msg.text().slice(0, 120)); });
  await page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(err => {
    console.warn(`  goto 警告: ${err.message}`);
  });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: out, fullPage });
  console.log(`截图已保存: ${out}（${fs.statSync(out).size} bytes）`);
  await browser.close();
})().catch(err => {
  console.error('截图失败:', err.message);
  if (/Executable doesn't exist/.test(err.message) || /browser.*not.*found/i.test(err.message)) {
    console.error('提示：浏览器二进制未找到，请确认已安装，或设 PLAYWRIGHT_BROWSERS_PATH=C:\\Users\\asus\\AppData\\Local\\ms-playwright');
  }
  process.exit(1);
});
