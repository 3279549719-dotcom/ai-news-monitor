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

// For search sources: title + snippet → relevance score + summary + event + category
// tier: 0/1 = top trusted media, 3 = low-trust tabloid, null/other = neutral
// categorySchema: keyword 的板块模板，如 {transfer:'转会&合同动态', ...}，AI 从中选一个
async function analyzeResult(query, title, snippet, tier = null, categorySchema = null) {
  const tierHint =
    tier === 0 || tier === 1
      ? '来源为顶级可信媒体，评分可相对宽松。'
      : tier === 3
        ? '来源为低可信小报，对标题党和捕风捉影内容主动降分。'
        : '';

  // 板块分类提示
  let categoryHint = '';
  if (categorySchema && Object.keys(categorySchema).length > 0) {
    const options = Object.entries(categorySchema)
      .map(([k, v]) => `"${k}"=${v}`)
      .join('，');
    categoryHint =
      `\n板块分类：从以下类别中选择最贴切的一个（只输出 key）：${options}。` +
      `如果都不合适，选最接近的。`;
  }

  const response = await getOpenAI().chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      {
        role: 'system',
        content: '你是信息筛选助手。只输出JSON，不要任何其他文字。',
      },
      {
        role: 'user',
        content:
          `判断以下文章是否与关键词"${query}"真正相关，输出JSON。\n` +
          `关键词：${query}\n` +
          `标题：${title}\n` +
          `摘要：${snippet || '（无）'}\n\n` +
          `输出格式：{"score": 0到100的整数, "summary": "相关时用3句中文概括核心内容，不相关时为空字符串", "event": "用一句话描述这篇文章报道的核心事件（如：曼联接近签下乌加特），不相关时为空字符串", "category": "板块分类key，不相关时为空字符串"}\n` +
          `评分标准（严格）：\n` +
          `- 80-100：文章核心主题就是该关键词，内容深度讨论\n` +
          `- 60-79：文章明显围绕该关键词展开，非泛泛提及\n` +
          `- 30-59：边缘相关，仅偶尔提及或仅标题含关键词词根\n` +
          `- 0-29：无关或仅共享某个词\n` +
          `score>=60 才视为相关并生成摘要。打分偏保守，宁可漏掉模糊结果，不要放入不相关内容。` +
          (tierHint ? `\n${tierHint}` : '') +
          (categoryHint ? categoryHint : ''),
      },
    ],
    max_tokens: 400,
    temperature: 0.1,
  });

  return parseAnalyzeResult(response.choices[0].message.content.trim());
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
// links: [{title|text, url}]；返回 [{title, url}]。logPrefix 提供时输出失败诊断日志。
async function selectArticleLinks(links, sourceName, pageUrl, logPrefix = '') {
  const list = links.map((l, i) => `[${i}] ${l.title || l.text || ''}\n  URL: ${l.url}`).join('\n');

  const response = await getOpenAI().chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      {
        role: 'system',
        content: `You are a web scraping assistant. From a list of links extracted from "${sourceName}" (page: ${pageUrl}), identify which are NEWS ARTICLES. Ignore navigation/menu/footer/social/homepage/trending-topic links. Return ONLY a JSON array: [{"index": number, "title": "clean title"}, ...]. Index refers to [N] number. Return [] if no articles found. No markdown, no explanation.`
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
