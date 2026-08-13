'use strict';

/**
 * AI / LLM module.
 *
 * Wraps the DeepSeek endpoint (OpenAI SDK compatible) behind a single client
 * and provides the shared analysis helpers used across the pipeline:
 *   - analyzeResult: relevance score + summary + event + category for search items
 *   - selectArticleLinks: pick real article links out of a scraped link list
 *   - summarizeArticle: LEGACY full-text summarization for the blog type
 * Prompts are externalized under src/prompts/.
 */

const OpenAI = require('openai');
const { getSecret, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, MIN_SCORE } = require('./config');
const { SYSTEM_PROMPT } = require('./prompts/analyze-prompt');
const { buildSelectLinksPrompt } = require('./prompts/select-links-prompt');

let _openai = null;

/**
 * Get the shared DeepSeek (OpenAI-compatible) client singleton.
 * @returns {OpenAI} OpenAI SDK client.
 */
function getOpenAI() {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: getSecret('DEEPSEEK_API_KEY'), baseURL: DEEPSEEK_BASE_URL });
  }
  return _openai;
}

/**
 * LEGACY: full-text summarization for blog-type sources only. Search-type
 * sources go through analyzeResult instead. If the blog channel ever needs
 * scoring/classification, migrate it to the analyzeResult options mode.
 * @param {string} title - Article title.
 * @param {string} content - Full article text.
 * @returns {Promise<string>} Chinese summary of the article.
 */
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
 * Build the category/board hint injected into the analyze prompt.
 * Supports both the old format {"transfer":"转会&合同动态"} and the new format
 * with per-category rules (label / match / ok / not). Prepends genre-precedence
 * rules so the model classifies genre (interview/match/rumour/...) before board.
 * @param {Object|Array|null} categorySchema - Keyword board schema.
 * @returns {string} Prompt hint text (empty when no schema is provided).
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

/**
 * Analyze a single search-type item: title + snippet + (optional) body →
 * relevance score, summary, event, event_type and category.
 * @param {{query:string, title:string, snippet?:string, tier?:number|null,
 *          categorySchema?:Object|null, body?:string|null}} options - Item context.
 * @returns {Promise<{relevant:boolean, score:number, summary:string,
 *          event:string, event_type:string, category:string}>} Parsed AI result.
 */
async function analyzeResult(options) {
  const { query, title, snippet, tier = null, categorySchema = null, body = null } = options;

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
        content: buildAnalyzePrompt({ query, title, snippet, tierHint, categoryHint, body }),
      },
    ],
    max_tokens: 600,
    temperature: 0.1,
  });

  return parseAnalyzeResult(response.choices[0].message.content.trim());
}

/**
 * Assemble the user prompt for analyzeResult from the item context.
 * @param {{query:string, title:string, snippet?:string, tierHint?:string,
 *          categoryHint?:string, body?:string|null}} options - Prompt inputs.
 * @returns {string} Full prompt text.
 */
function buildAnalyzePrompt(options) {
  const { query, title, snippet, tierHint, categoryHint, body } = options;
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

/**
 * Pure function: parse the AI's JSON response text into a normalized result.
 * Tolerates markdown fences, dirty prefixes and out-of-range scores.
 * @param {string} text - Raw AI output.
 * @returns {{relevant:boolean, score:number, summary:string, event:string,
 *          event_type:string, category:string}} Normalized result; on parse
 *          failure returns score 0 / relevant false with empty strings.
 */
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

/**
 * Shared helper: ask the AI to pick real article links out of a scraped link
 * list. Used by both the crawl4ai and scraper-direct channels.
 * @param {Array} links - Links as [{title, text, url}].
 * @param {string} sourceName - Source display name (for the prompt).
 * @param {string} pageUrl - Page the links came from.
 * @param {string} [logPrefix=''] - Console log prefix, e.g. 'Crawl4ai' / 'Direct'.
 * @returns {Promise<Array>} Selected [{title, url}] (url guaranteed non-empty).
 */
async function selectArticleLinks(links, sourceName, pageUrl, logPrefix = '') {
  const list = links.map((l, i) => `[${i}] ${l.title || l.text || ''}\n  URL: ${l.url}`).join('\n');

  const response = await getOpenAI().chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      {
        role: 'system',
        content: buildSelectLinksPrompt(sourceName, pageUrl),
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

// ============================================================================
// V2: 原生 function calling（替代 prompt + 正则解析）
// DeepSeek API 支持 OpenAI-compatible tools 参数。
// analyzer_tools 和 select_links_tool 放在尾部以减少对现有代码的视觉噪声。
// ============================================================================

const ANALYZE_TOOL = {
  type: 'function',
  function: {
    name: 'report_article_analysis',
    description: '对一篇文章进行相关性评分、中文摘要、事件提取和分类。当 score < 60 时 summary/event/event_type/category 全部为空字符串。',
    parameters: {
      type: 'object',
      properties: {
        score: { type: 'integer', description: '相关性评分 0-100。80-100=核心主题，60-79=明显相关，30-59=边缘，0-29=无关' },
        summary: { type: 'string', description: '三段式中日摘要：【事件】一句话 【要点】2-3条 【为什么重要】一句话。score<60 时为空字符串。' },
        event: { type: 'string', description: '核心事件：实体+动作+对象。score<60 时为空' },
        event_type: { type: 'string', enum: ['interview', 'match', 'rumour', 'injury', 'deal', 'official', 'analysis', ''], description: '体裁分类，无证据时为空' },
        category: { type: 'string', description: '板块分类key，无匹配时为空或 other' },
      },
      required: ['score', 'summary', 'event', 'event_type', 'category'],
      additionalProperties: false,
    },
  },
};

const SELECT_LINKS_TOOL = {
  type: 'function',
  function: {
    name: 'select_articles',
    description: '从页面链接列表中选出真正的文章链接（非导航/广告/侧栏），返回 index 数组。',
    parameters: {
      type: 'object',
      properties: {
        articles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              index: { type: 'integer', description: '链接在原始列表中的索引' },
              title: { type: 'string', description: '文章标题' },
            },
            required: ['index', 'title'],
            additionalProperties: false,
          },
          description: '选中的文章链接列表',
        },
      },
      required: ['articles'],
      additionalProperties: false,
    },
  },
};

/**
 * V2: 用原生 function calling 分析文章。
 * 相比 v1 (prompt + JSON.parse + 正则 fallback)，v2 在 API 层保证输出符合 schema，
 * 不再需要 parseAnalyzeResult 的 try-catch 兜底。
 *
 * 保留 v1 作为 fallback：如果 API 返回 tool_calls 为空（极少数模型兼容性问题），
 * 自动降级到 v1 的 prompt 模式。
 */
async function analyzeResultV2(options) {
  const { query, title, snippet, tier = null, categorySchema = null, body = null } = options;

  const tierHint =
    tier === 0
      ? '来源为T0官方/权威信源，默认可信度最高。'
      : '';

  const categoryHint = buildCategoryHint(categorySchema);

  // 复用 v1 的用户 prompt 内容（评分标准、摘要格式、事件提取、过滤提示等）
  const userPrompt = buildAnalyzePrompt({ query, title, snippet, tierHint, categoryHint, body });

  try {
    const response = await getOpenAI().chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
        },
        { role: 'user', content: userPrompt },
      ],
      tools: [ANALYZE_TOOL],
      tool_choice: { type: 'function', function: { name: 'report_article_analysis' } },
      max_tokens: 600,
      temperature: 0.1,
    });

    const toolCalls = response.choices[0].message.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const args = JSON.parse(toolCalls[0].function.arguments);
      return normalizeV2Result(args);
    }
    // fallback: 如果模型没返回 tool_call（兼容性），降级到 v1
    return parseAnalyzeResult(response.choices[0].message.content || '');
  } catch (e) {
    // API 错误时回退到 v1
    console.warn(`[ai.js] function calling failed, fallback to v1: ${e.message}`);
    return analyzeResult(options);
  }
}

function normalizeV2Result(result) {
  const score = Math.max(0, Math.min(100, Number(result.score) || 0));
  return {
    relevant: score >= MIN_SCORE,
    score,
    summary: typeof result.summary === 'string' ? result.summary.trim() : '',
    event: typeof result.event === 'string' ? result.event.trim() : '',
    event_type: typeof result.event_type === 'string' ? result.event_type.trim() : '',
    category: typeof result.category === 'string' ? result.category.trim() : '',
  };
}

/**
 * V2: 用原生 function calling 选文章链接。
 * 替代 v1 的 JSON 文本 + 手动剥 markdown fence + try-catch 解析。
 */
async function selectArticleLinksV2(links, sourceName, pageUrl, logPrefix = '') {
  const list = links.map((l, i) => `[${i}] ${l.title || l.text || ''}\n  URL: ${l.url}`).join('\n');

  try {
    const response = await getOpenAI().chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages: [
        {
          role: 'system',
          content: buildSelectLinksPrompt(sourceName, pageUrl),
        },
        { role: 'user', content: list },
      ],
      tools: [SELECT_LINKS_TOOL],
      tool_choice: { type: 'function', function: { name: 'select_articles' } },
      temperature: 0,
      max_tokens: 2000,
    });

    const toolCalls = response.choices[0].message.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const args = JSON.parse(toolCalls[0].function.arguments);
      if (!Array.isArray(args.articles)) return [];
      return args.articles
        .map(a => ({ title: a.title || '', url: links[a.index]?.url || '' }))
        .filter(a => a.url);
    }

    // fallback to v1
    if (logPrefix) console.log(`  [${logPrefix}] ${sourceName}: function calling returned no tool_calls, fallback`);
    return selectArticleLinks(links, sourceName, pageUrl, logPrefix);
  } catch (e) {
    console.warn(`  [${logPrefix || 'ai'}] function calling failed for ${sourceName}, fallback: ${e.message}`);
    return selectArticleLinks(links, sourceName, pageUrl, logPrefix);
  }
}

/**
 * 评审修复 P0-1：v2 接线入口。
 * AI_FC env：auto（默认）→ v2（内部自带 v1 fallback）；v1 → 强制旧路径。
 * _impl 为测试注入点（可选），生产不传。
 */
function fcMode() {
  return process.env.AI_FC || 'auto';
}

async function analyzeResultSmart(options, _impl) {
  const impl = _impl || { v2: analyzeResultV2, v1: analyzeResult };
  return fcMode() === 'v1' ? impl.v1(options) : impl.v2(options);
}

async function selectArticleLinksSmart(links, sourceName, pageUrl, logPrefix = '', _impl) {
  const impl = _impl || { v2: selectArticleLinksV2, v1: selectArticleLinks };
  return fcMode() === 'v1'
    ? impl.v1(links, sourceName, pageUrl, logPrefix)
    : impl.v2(links, sourceName, pageUrl, logPrefix);
}

module.exports = {
  getOpenAI,
  summarizeArticle,
  analyzeResult,
  analyzeResultV2,
  parseAnalyzeResult,
  selectArticleLinks,
  selectArticleLinksV2,
  buildAnalyzePrompt,
  buildCategoryHint,
  fcMode,
  analyzeResultSmart,
  selectArticleLinksSmart,
};
