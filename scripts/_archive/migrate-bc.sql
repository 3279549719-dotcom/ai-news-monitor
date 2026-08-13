-- ============================================
-- ai-news-monitor 方案B/C 数据库迁移
-- 执行方式：Supabase Dashboard → SQL Editor → New query → 粘贴执行
-- ============================================

-- 1. articles 表新增 5 列
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS event TEXT,
  ADD COLUMN IF NOT EXISTS confidence TEXT CHECK (confidence IN ('high','medium','low')),
  ADD COLUMN IF NOT EXISTS corroboration_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conflict_flag BOOLEAN DEFAULT false;

-- 2. keywords 表新增 category_schema
ALTER TABLE keywords
  ADD COLUMN IF NOT EXISTS category_schema JSONB;

-- 3. 为 4 个关键词插入板块模板
UPDATE keywords SET category_schema = '{
  "official": "官方公告",
  "transfer": "转会&合同动态",
  "injury": "伤病&停赛",
  "management": "管理层·教练组·更衣室",
  "match": "赛事竞技资讯",
  "rumour": "未证实传闻",
  "conflict": "冲突与辟谣",
  "academy_women": "青训&女足"
}' WHERE id = 'manchester-united';

UPDATE keywords SET category_schema = '{
  "official": "官方公告",
  "product": "产品发布",
  "research": "研究进展",
  "other": "其他"
}' WHERE id IN ('anthropic', 'dallas-mavericks', 'claude-blog');

-- 4. 验证
SELECT column_name FROM information_schema.columns
WHERE table_name = 'articles'
AND column_name IN ('category','event','confidence','corroboration_count','conflict_flag');

SELECT id, category_schema FROM keywords ORDER BY id;
