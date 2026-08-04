const puppeteer = require('puppeteer-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'E:/claude/ai-news-monitor/docs/board-view.png';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1700 });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // 1. 点击"按关键词"Tab
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('nav button, header button'));
    const target = btns.find(b => b.textContent.includes('按关键词'));
    if (target) { target.click(); return 'clicked 按关键词'; }
    return 'not found: ' + btns.map(b => b.textContent.trim()).join('|');
  });
  console.log('Tab:', clicked);
  await new Promise(r => setTimeout(r, 2000));

  // 2. 点击 Manchester United 关键词按钮
  const clicked2 = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const target = btns.find(b => b.textContent.includes('Manchester United'));
    if (target) { target.click(); return 'clicked MU'; }
    return 'not found: ' + btns.slice(0, 15).map(b => b.textContent.trim().slice(0, 20)).join('|');
  });
  console.log('Keyword:', clicked2);
  await new Promise(r => setTimeout(r, 5000));

  // 3. 检查板块
  const board = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      official: text.includes('官方公告'),
      transfer: text.includes('转会'),
      injury: text.includes('伤病'),
      management: text.includes('管理层'),
      match: text.includes('赛事竞技'),
      overview: text.includes('今日概览'),
      head: text.substring(0, 150),
    };
  });
  console.log('Board:', JSON.stringify(board, null, 1));

  await page.screenshot({ path: OUT, fullPage: true });
  console.log('✅ Screenshot:', OUT);
  await browser.close();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
