const OpenAI = require('openai');

let client;

function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    });
  }
  return client;
}

// For blog sources: full article content → Chinese summary
async function summarizeArticle(title, content) {
  const response = await getClient().chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
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

// For search sources: title + snippet → relevance score + summary
async function analyzeResult(query, title, snippet) {
  const response = await getClient().chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
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
          `输出格式：{"score": 0到100的整数, "summary": "相关时用3句中文概括核心内容，不相关时为空字符串"}\n` +
          `评分标准（严格）：\n` +
          `- 80-100：文章核心主题就是该关键词，内容深度讨论\n` +
          `- 60-79：文章明显围绕该关键词展开，非泛泛提及\n` +
          `- 30-59：边缘相关，仅偶尔提及或仅标题含关键词词根\n` +
          `- 0-29：无关或仅共享某个词\n` +
          `score>=60 才视为相关并生成摘要。打分偏保守，宁可漏掉模糊结果，不要放入不相关内容。`,
      },
    ],
    max_tokens: 300,
    temperature: 0.1,
  });

  const text = response.choices[0].message.content.trim();
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const result = JSON.parse(match ? match[0] : text);
    const score = Math.max(0, Math.min(100, Number(result.score) || 0));
    return {
      relevant: score >= 60,
      score,
      summary: typeof result.summary === 'string' ? result.summary.trim() : '',
    };
  } catch {
    return { relevant: false, score: 0, summary: '' };
  }
}

module.exports = { summarizeArticle, analyzeResult };
