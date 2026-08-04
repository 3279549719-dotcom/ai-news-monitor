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

// 摘要 6 铁律（Phase8 理解层 v2）。buildAnalyzePrompt 的摘要区块引用本常量，勿在两处重复维护。
const SYSTEM_PROMPT = [
  '你是信息筛选助手。只输出JSON，不要任何其他文字。',
  '',
  '摘要 6 铁律（写 summary 时必须全部遵守）：',
  '',
  '①【不编造】标题里没有的数字、金额、比分、引语、条款一律不得虚构；拿不到就明说（"标题未给出可验证细节（需点开正文）"/"标题信息有限，真实影响需读原文"），编造比空话更严重。',
  '②【首句即结论】【事件】= 谁 + 做了什么 + 结果/量化信息，专名和数字顶句首；禁止"这一举措/该公司/某球员"等指代词。',
  '③【要点是增量】每条要点必须能独立成立；判断标准：删掉这条标题信息量变不变，没变=复述直接删；至少一条锚定专名或数字/日期；榨不出可验证细节就写"标题未给出可验证细节（需点开正文）"。',
  '④【为什么重要要落地】写"谁（具体人群/组织）因什么具体变化受影响"；禁止"对X而言，这意味着…/至关重要/意义重大"。',
  '⑤【空话禁词表】这一举措、这一决定、此举、该球员、该消息、该操作、相关人士、相关机构、某球员、某公司、上述操作、进行了、展现了、体现了、反映了、旨在、有着重要意义、至关重要、意义重大。',
  '⑥【字数上限】【事件】≤40字；每条【要点】≤25字，最多3条；【为什么重要】≤40字；全文≤180字。宁可短，不可空。',
].join('\n');

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
  // 兼容 anthropic 历史脏数据：category_schema 是 JSON 数组（["official","product",...]）时转成对象，避免数字键
  if (Array.isArray(categorySchema)) {
    categorySchema = Object.fromEntries(categorySchema.map(k => [k, k]));
  }
  if (!categorySchema || Object.keys(categorySchema).length === 0) return '';

  const lines = ['板块分类（证据归类）：分类必须能从标题或摘要中找到一条原话证据直接支撑；找不到证据选 other（若存在）。'];

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

  // 体裁前置通用段（不依赖具体 schema）：先按体裁分流，再进板块判断
  lines.push(
    '',
    '=== 体裁前置规则（先于板块判断，必须遵守）===',
    '',
    '- 访谈/人物特写（interview / sits down with / Q&A / 独家专访）→ other',
    '- 赛后复盘/前瞻 → match',
    '- 纯传闻（reported interest / believed / linked，无官方或顶级跟队确认）→ rumour',
    '- 标题含 injury/recovery/return/fit 等词 ≠ 伤病新闻，必须描述具体伤情/缺阵/恢复时间表才归 injury',
    '- 铁律：访谈/特写永远不是 injury/transfer/trade/management 等事件类。',
    '',
    '证据不足或体裁不符时选 other；找不到证据不得硬塞。',
  );

  return '\n' + lines.join('\n');
}

// For search sources: title + snippet + body → relevance score + summary + event + event_type + category
async function analyzeResult(query, title, snippet, tier = null, categorySchema = null, body = null) {
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
        content: SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: buildAnalyzePrompt(query, title, snippet, tierHint, categoryHint, body),
      },
    ],
    max_tokens: 600,
    temperature: 0.1,
  });

  return parseAnalyzeResult(response.choices[0].message.content.trim());
}

function buildAnalyzePrompt(query, title, snippet, tierHint, categoryHint, body) {
  return [
    `判断以下文章是否与关键词"${query}"真正相关，输出JSON。`,
    '',
    `关键词：${query}`,
    `标题：${title}`,
    `摘要：${snippet || '（无）'}`,
    body ? `\n正文片段：${body}` : '',
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
    '正例（摘要要这样写）：',
    '- 标题《Anthropic 宣布攻破 3 家公司》→ 摘要【事件】写"Anthropic 宣布攻破 3 家公司"（必须含"3 家"，不写"多家"）',
    '- 标题 "What Mavericks Extending Naji Marshall Means" → 摘要【要点】点名 "Naji Marshall"，禁止写成"该球员"',
    '',
    '反例（摘要绝不能这样写）：',
    '- 标题没提比分，摘要却写"2-0 获胜" → 违反①不编造',
    '- 摘要写"这一举措回应了关切" → 违反②③，要点必须点名，空话直接删',
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
    'event_type 从以下体裁中选一个（若证据支持）：interview(访谈/人物特写) / match(赛后复盘/前瞻) / rumour(传闻) / injury(伤病，必须有具体伤情/缺阵/恢复时间表证据) / deal(转会/签约/续约) / official(官方公告) / analysis(深度分析) / 其他情况为空字符串。',
    '',
    '=== 过滤提示 ===',
    '',
    '以下情况应降低评分（但不要一刀切判死）：',
    '- 关键词仅在文章中被顺带提及，核心主语是另一个实体 → score 适合 30-59',
    '- 标题完全不包含关键词的任何词根 → 需仔细判断，但标题提到的球员/产品可能属于该关键词范围',
    '',
    `输出JSON格式：{"score":整数,"summary":"三段式摘要或空","event":"事件描述或空","event_type":"体裁key或空","category":"板块key或空"}`,
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
      event_type: typeof result.event_type === 'string' ? result.event_type.trim() : '',
      category: typeof result.category === 'string' ? result.category.trim() : '',
    };
  } catch {
    return { relevant: false, score: 0, summary: '', event: '', event_type: '', category: '' };
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

module.exports = {
  getOpenAI,
  summarizeArticle,
  analyzeResult,
  parseAnalyzeResult,
  selectArticleLinks,
  buildAnalyzePrompt,
  buildCategoryHint,
};