'use strict';

const OpenAI = require('openai');
const { DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, MIN_SCORE } = require('./config');

let _openai = null;

// DeepSeek（openai 兼容）客户端唯一单例，全库共用
function getOpenAI() {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: DEEPSEEK_API_KEY, baseURL: DEEPSEEK_BASE_URL });
  }
  return _openai;
}

// For blog sources: full article content → Chinese summary
async function summarizeArticle(title, content) {
  const response = await getOpenAI().chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      {
        role: 'system',
        content: '你是科技资讯助手。请用3-5句中文简要概括文章核心内容：讲了什么、有何重要意义。语言简洁直接，不要开场白。',
      },
      {
        role: 'user',
        content: `标题：${title}\n\n内容：${content}`,
      },
    ],
    max_tokens: 300,
    temperature: 0.3,
  });

  return response.choices[0].message.content.trim();
}

/**
 * Build category hint with rules for AI classification.
 * Supports both old format {"transfer":"转会&合同动态"} and new format with rules.
 */
function buildCategoryHint(categorySchema) {
  if (!categorySchema || Object.keys(categorySchema).length === 0) return '';

  const lines = ['板块分类：从以下板块中选择最贴切的一个（只输出 key）。'];

  for (const [key, val] of Object.entries(categorySchema)) {
    if (typeof val === 'string') {
      lines.push(`- "${key}"=${val}`);
    } else if (typeof val === 'object' && val.label) {
      lines.push(`- "${key}"=${val.label}`);
      if (val.match) lines.push(`  判别标准：${val.match}`);
      if (val.ok) lines.push(`  正例："${val.ok}"`);
      if (val.not) lines.push(`  别选错："${val.not}"`);
    }
  }

  lines.push('', '不确定时选最接近的，不要选"other"作为偷懒选项。');

  return '\n' + lines.join('\n');
}

// For search sources: title + snippet → relevance score + summary + event + category
async function analyzeResult(query, title, snippet, tier = null, categorySchema = null) {
  const tierHint =
    tier === 0
      ? '来源为T0官方/权威信源，默认可信度最高。'
      : '';

  const categoryHint = buildCategoryHint(categorySchema);

  const response = await getOpenAI().chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      {
        role: 'system',
        content: '你是信息筛选助手。只输出JSON，不要任何其他文字。',
      },
      {
        role: 'user',
        content: buildAnalyzePrompt(query, title, snippet, tierHint, categoryHint),
      },
    ],
    max_tokens: 600,
    temperature: 0.1,
  });

  return parseAnalyzeResult(response.choices[0].message.content.trim());
}

function buildAnalyzePrompt(query, title, snippet, tierHint, categoryHint) {
  return [
    `判断以下文章是否与关键词"${query}"真正相关，输出JSON。`,
    '',
    `关键词：${query}`,
    `标题：${title}`,
    `摘要：${snippet || '（无）'}`,
    '',
    '=== 评分标准 ===',
    '',
    '从以下分数段中选择：',
    '- 80-100：文章核心主题就是该关键词，内容深度讨论',
    '- 60-79：文章明显围绕该关键词展开，非泛泛提及',
    '- 30-59：边缘相关，仅偶尔提及',
    '- 0-29：无关或仅共享某个词',
    '',
    'score>=60 才视为相关。打分偏保守，但不要过度——明确相关的文章应打 60+。',
    tierHint ? `\n${tierHint}` : '',
    '',
    '=== 摘要格式 ===',
    '',
    '当 score>=60 时，摘要按三段式输出：',
    '',
    '【事件】一句话说清发生了什么（谁 + 做了什么 + 结果/影响）',
    '【要点】2-3个具体事实或数据',
    '【为什么重要】一句话说明这条信息对关注该关键词的人意味着什么',
    '',
    '要求：摘要必须比标题提供更多信息，不要只复述标题。',
    '禁止：使用"可能讨论了""由于缺乏细节""具体细节不明"等占位语。',
    '',
    '当 score<60 时，summary 为空字符串。',
    '',
    categoryHint,
    '',
    '=== 事件提取 ===',
    '',
    'event 字段用一句话描述核心事件。格式："实体 + 动作 + 对象"。',
    '不相关时 event 为空字符串。',
    '',
    '=== 过滤提示 ===',
    '',
    '以下情况应降低评分（但不要一刀切判死）：',
    '- 关键词仅在文章中被顺带提及，核心主语是另一个实体 → score 适合 30-59',
    '- 标题完全不包含关键词的任何词根 → 需仔细判断，但标题提到的球员/产品可能属于该关键词范围',
    '',
    `输出JSON格式：{"score":整数,"summary":"三段式摘要或空","event":"事件描述或空","category":"板块key或空"}`,
  ].join('\n');
}

// 纯函数：解析 analyzeResult 的 AI 返回文本（markdown 围栏/脏前缀/score 越界都容错）
function parseAnalyzeResult(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const result = JSON.parse(match ? match[0] : text);
    const score = Math.max(0, Math.min(100, Number(result.score) || 0));
    return {
      relevant: score >= MIN_SCORE,
      score,
      summary: typeof result.summary === 'string' ? result.summary.trim() : '',
      event: typeof result.event === 'string' ? result.event.trim() : '',
      category: typeof result.category === 'string' ? result.category.trim() : '',
    };
  } catch {
    return { relevant: false, score: 0, summary: '', event: '', category: '' };
  }
}

// 共享：从链接列表让 AI 挑文章（crawl4ai 与 scraper-direct 两通道共用）。
async function selectArticleLinks(links, sourceName, pageUrl, logPrefix = '') {
  const list = links.map((l, i) => `[${i}] ${l.title || l.text || ''}\n  URL: ${l.url}`).join('\n');

  const response = await getOpenAI().chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      {
        role: 'system',
        content: [
          `You are a web scraping assistant. From a list of links extracted from "${sourceName}" (page: ${pageUrl}), identify which are NEWS ARTICLES (editorial content with a specific story or report).`,
          '',
          'These are NOT news articles and MUST be excluded:',
          '- Standings / League tables / Scores / Box scores / Schedule / Fixtures / Results',
          '- Stats / Player statistics / Fantasy sports / Power rankings',
          '- Tickets / Shop / Merchandise / Sponsorship / Suites / Hospitality',
          '- Draft picks (bare list, no story) / Mock drafts',
          '- Video highlights / Photo galleries / Podcast episodes',
          '- About/Contact/Privacy/Terms/Subscribe pages',
          '- Generic navigation: Home, News, Sports, Teams, Trending',
          '',
          'Return ONLY a JSON array: [{"index": number, "title": "clean title"}, ...].',
          'Index refers to the [N] number. Return [] if no articles found.',
          'No markdown, no explanation.',
        ].join('\n'),
      },
      { role: 'user', content: list },
    ],
    temperature: 0,
    max_tokens: 2000,
  });

  const raw = (response.choices[0].message.content || '').trim();
  if (!raw) {
    if (logPrefix) console.log(`  [${logPrefix}] ${sourceName}: AI 返回空内容`);
    return [];
  }

  const jsonStr = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  let articles;
  try {
    articles = JSON.parse(jsonStr);
  } catch {
    if (logPrefix) console.log(`  [${logPrefix}] ${sourceName}: AI 返回非 JSON: ${raw.substring(0, 80)}`);
    return [];
  }
  if (!Array.isArray(articles)) return [];

  return articles
    .map(a => ({ title: a.title || '', url: links[a.index]?.url || '' }))
    .filter(a => a.url);
}

module.exports = { getOpenAI, summarizeArticle, analyzeResult, parseAnalyzeResult, selectArticleLinks };