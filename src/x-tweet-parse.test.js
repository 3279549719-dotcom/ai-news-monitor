'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  snowflakeTimestamp,
  handleFromProfileUrl,
  statusUrlFor,
  extractTweetsFromMarkdown,
  parseTwikitRows,
} = require('./x-tweet-parse');

test('雪花 ID 解码为发推时间', () => {
  // 实测 2085376698753655092 → 2026 年内（snowflake: (id>>22) + 1288834974657）
  const d = snowflakeTimestamp('2085376698753655092');
  assert.ok(d instanceof Date);
  assert.ok(d.getTime() > Date.UTC(2026, 0, 1));
  assert.equal(snowflakeTimestamp(''), null);
  assert.equal(snowflakeTimestamp(null), null);
  assert.equal(snowflakeTimestamp('abc'), null);
});

test('从账号页 URL 提取 handle', () => {
  assert.equal(handleFromProfileUrl('https://x.com/David_Ornstein'), 'David_Ornstein');
  assert.equal(handleFromProfileUrl('https://x.com/sistoney67/with_replies'), 'sistoney67');
  assert.equal(handleFromProfileUrl(''), '');
});

test('构造状态链接', () => {
  assert.equal(statusUrlFor('David_Ornstein', '123'), 'https://x.com/David_Ornstein/status/123');
});

test('从 crawl4ai markdown 提取推文卡（含卡片与纯文字）', () => {
  const md = `[](https://x.com/)
[Log in](https://x.com/i/jf/onboarding/web?mode=login)
[David Ornstein](https://x.com/David_Ornstein)
[@David_Ornstein](https://x.com/David_Ornstein)
[1h](https://x.com/David_Ornstein/status/2085376698753655092)
🚨 West Ham United talks with Tottenham Hotspur over Manor Solomon currently off for financial reasons. [#WHUFC](https://x.com/hashtag/WHUFC) [@TheAthleticFC](https://x.com/TheAthleticFC)
[ ![...](x)West Ham card ](https://t.co/fAe1PyA69M)[From nytimes.com](https://t.co/fAe1PyA69M)
463
568
10K
992K
[David Ornstein](https://x.com/David_Ornstein)
[@David_Ornstein](https://x.com/David_Ornstein)
[3h](https://x.com/David_Ornstein/status/2085342639696527389)
🚨 Carlos Baleba doubtful for start of new campaign through injury. [@TheAthleticFC](https://x.com/TheAthleticFC)
## Log in or sign up for X`;
  const tweets = extractTweetsFromMarkdown(md, 'David_Ornstein');
  assert.equal(tweets.length, 2);
  assert.ok(tweets[0].title.includes('West Ham United talks'));
  assert.equal(tweets[0].url, 'https://x.com/David_Ornstein/status/2085376698753655092');
  assert.ok(tweets[0].publishedAt instanceof Date);
  assert.ok(tweets[1].title.includes('Carlos Baleba'));
  // 卡片标题与 t.co 链接不进 title/url
  assert.ok(!tweets[0].title.includes('West Ham card'));
});

test('extractTweetsFromMarkdown：无状态链接返回空', () => {
  assert.deepEqual(extractTweetsFromMarkdown('no status links here', 'David_Ornstein'), []);
  assert.deepEqual(extractTweetsFromMarkdown('', 'David_Ornstein'), []);
  assert.deepEqual(extractTweetsFromMarkdown('text', ''), []);
});

test('parseTwikitRows：twikit JSON → item', () => {
  const source = { source_name: 'David Ornstein (X)', tier: 1 };
  const rows = [
    {
      handle: 'David_Ornstein',
      status_id: '2085376698753655092',
      text: 'Manchester United are in talks to sign a striker.',
      created_at: '2026-08-07T01:00:00+00:00',
    },
  ];
  const items = parseTwikitRows(source, rows);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://x.com/David_Ornstein/status/2085376698753655092');
  assert.equal(items[0].title, 'Manchester United are in talks to sign a striker.');
  assert.equal(items[0].source, 'david-ornstein-(x)');
  assert.equal(items[0].tier, 1);
  assert.ok(items[0].publishedAt instanceof Date);
});

test('parseTwikitRows：过滤过短/无效行', () => {
  const source = { source_name: 'Andy Mitten (X)', tier: 1 };
  const items = parseTwikitRows(source, [
    { handle: 'AndyMitten', status_id: '1', text: 'hi', created_at: null },
    { handle: '', status_id: '', text: '', created_at: null },
    { handle: 'AndyMitten', status_id: '99', text: 'A proper Manchester United tweet about the dressing room.', created_at: '2026-08-07T00:00:00+00:00' },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://x.com/AndyMitten/status/99');
});
