'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isGenericCta, extractMarkdownLinks, cleanArticleBody, isNavBlock } = require('./crawl4ai-fetch');

// ── isGenericCta ────────────────────────────────────────────────
test('isGenericCta：识别 "Read more"/"Learn more" 等无信息量锚文本', () => {
  assert.equal(isGenericCta('Read more'), true);
  assert.equal(isGenericCta('Read More'), true);
  assert.equal(isGenericCta('learn more'), true);
  assert.equal(isGenericCta('Continue reading'), true);
  assert.equal(isGenericCta('View article'), true);
  assert.equal(isGenericCta(''), false);
  assert.equal(isGenericCta('Claude Code now supports artifacts'), false);
  assert.equal(isGenericCta('Auto mode is now the default in Claude Code'), false);
});

// ── extractMarkdownLinks：卡片式博客标题修复 ─────────────────────
test('extractMarkdownLinks：卡片式 "## 标题 | 日期 | [Read more](url)" 用标题当链接文本', () => {
  const md = [
    '# Blog',
    '## Claude Code now supports artifacts | June 18, 2026 | [Read more](https://claude.com/blog/artifacts-in-claude-code)Read more |',
    '## Building intelligent apps for Apple platforms | June 8, 2026 | [Read more](https://claude.com/blog/building-intelligent-apps)',
    '## New in Claude Managed Agents: self-hosted sandboxes | May 19, 2026 | [Read more](https://claude.com/blog/claude-managed-agents-updates)Read more |',
  ].join('\n');

  const links = extractMarkdownLinks(md);
  const byUrl = Object.fromEntries(links.map(l => [l.url, l.text]));

  // 卡片式：真实标题替代 "Read more"（且同 URL 只出现一次，无 "Read more" 占位残留）
  assert.equal(links.length, 3);
  assert.equal(byUrl['https://claude.com/blog/artifacts-in-claude-code'], 'Claude Code now supports artifacts');
  assert.equal(byUrl['https://claude.com/blog/building-intelligent-apps'], 'Building intelligent apps for Apple platforms');
  assert.equal(byUrl['https://claude.com/blog/claude-managed-agents-updates'], 'New in Claude Managed Agents: self-hosted sandboxes');
  assert.ok(links.every(l => l.text !== 'Read more'), '不应残留 "Read more" 占位标题');
});

test('extractMarkdownLinks：无卡片结构的普通链接保持原样（CTA 空标题由下游 add() 兜底）', () => {
  const md = '[An article about Claude](https://example.com/a) [Read more](https://example.com/b)';
  const links = extractMarkdownLinks(md);
  assert.deepEqual(
    links.map(l => ({ u: l.url, t: l.text })),
    [
      { u: 'https://example.com/a', t: 'An article about Claude' },
      { u: 'https://example.com/b', t: 'Read more' },
    ],
  );
});

test('extractMarkdownLinks：Guardian 式 "[](url) ### 标题" 仍生效', () => {
  const md = '[](https://theguardian.com/football/2026/jan/01/title) ### Manchester United beat Arsenal';
  const links = extractMarkdownLinks(md);
  assert.deepEqual(links[0].url, 'https://theguardian.com/football/2026/jan/01/title');
  assert.equal(links[0].text, 'Manchester United beat Arsenal');
});

test('extractMarkdownLinks：裸空锚链接仍保留（空标题交下游 titleFromSlug 兜底）', () => {
  const md = '[](https://example.com/a) ### 有标题链接 [text](https://example.com/b)\n[](https://example.com/c)';
  const links = extractMarkdownLinks(md);
  const urls = links.map(l => l.url);
  assert.ok(urls.includes('https://example.com/a'), '空锚+### 标题应被 Guardian 式捕获');
  assert.ok(urls.includes('https://example.com/c'), '裸空锚链接不应被丢弃（title 留空待 slug 兜底）');
  const c = links.find(l => l.url === 'https://example.com/c');
  assert.equal(c.text, '');
});

// ── isNavBlock ──────────────────────────────────────────────────
test('isNavBlock：链接多且每链接纯文字少 → 导航菜单段', () => {
  const nav =
    '[](https://claude.com) * Meet Claude Products * [Claude](https://claude.com/product/overview) ' +
    '* [Claude Code](https://claude.com/product/claude-code) * [Claude Cowork](https://claude.com/product/cowork) ' +
    '* [Claude for Chrome](https://claude.com/claude-for-chrome) * [Skills](https://claude.com/skills)';
  assert.equal(isNavBlock(nav), true);
});

test('isNavBlock：真实正文段（链接少/每链接文字多）→ 非导航', () => {
  const prose =
    "We're making auto mode the default in Claude Code. Starting on August 6, 2026, " +
    'Pro, Max, and Team plans will use auto mode by default. [Read the docs](https://code.claude.com/docs)';
  assert.equal(isNavBlock(prose), false);
});

// ── cleanArticleBody：导航段污染修复 ─────────────────────────────
test('cleanArticleBody：站点导航段被剔除，正文不被挤掉（claude.com 复现场景）', () => {
  const md = [
    // 顶部导航：链接多、短 token 列表（真实 claude.com 头部导航形态）
    '[](https://claude.com) * Meet Claude Products * [Claude](https://claude.com/product/overview) ' +
      '* [Claude Code](https://claude.com/product/claude-code) * [Claude Cowork](https://claude.com/product/cowork) ' +
      '* Features * [Claude for Chrome](https://claude.com/claude-for-chrome) * [Skills](https://claude.com/skills)',
    '',
    "We're making auto mode the default in Claude Code. Starting on August 6, 2026, Pro, Max, and Team plans will use auto mode by default.",
    '',
    'Auto mode lets Claude decide the next action and run it, then shows you what changed for review. Users who stay in auto mode ship faster.',
    '',
    '### Why now',
    '',
    'Auto mode is the default for a reason: review is cheap, and the loop tightens as Claude learns your codebase.',
  ].join('\n');

  const body = cleanArticleBody(md);
  assert.ok(body, '应提取到正文');
  assert.ok(body.includes('auto mode'), '正文应包含真正文关键词');
  assert.ok(!body.includes('Meet Claude Products'), '导航菜单不应残留');
  assert.ok(!body.includes('product/overview'), '导航链接不应残留');
  assert.ok(body.startsWith("We're making auto mode"), '正文应从真正文开头，而非导航');
});

test('cleanArticleBody：纯正文无导航，原样返回并截 1500 字', () => {
  const longProse = Array.from({ length: 200 }, (_, i) => `这是正文第 ${i} 句，讲述某事件。`).join('');
  const body = cleanArticleBody(longProse);
  assert.ok(body);
  assert.ok(body.length <= 1500);
  assert.ok(body.includes('这是正文第 0 句'));
});

test('cleanArticleBody：头部段落链接密集但通过 isNavBlock 时，以最长段为锚重取', () => {
  // 首段：9 个链接 + 720 字符正文 → 每链接 ~80 字符，非 isNavBlock，但头部 300 字内链接 ≥8 → 触发最长段锚定
  const linkList = Array.from({ length: 9 }, (_, i) => `[ref${i}](https://e.com/${i})`).join(' ');
  const p1 = linkList + ' ' + '短开头段正文。'.repeat(60);
  const p2 = '真正文章主体，很长很长。'.repeat(300); // 最长段
  const body = cleanArticleBody([p1, '', p2].join('\n'));
  assert.ok(body.startsWith('真正文章主体'), '应锚定到最长正文段，而非链接密集开头');
});

test('cleanArticleBody：空输入返回 null', () => {
  assert.equal(cleanArticleBody(null), null);
  assert.equal(cleanArticleBody(''), null);
});
