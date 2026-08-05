import { createClient } from '@supabase/supabase-js';

/**
 * Shared Supabase client for the frontend. Reads VITE_SUPABASE_URL /
 * VITE_SUPABASE_KEY (typed in vite-env.d.ts); throws at startup when they are
 * missing so the app fails loudly instead of rendering a blank page.
 */
// VITE_* 变量类型见 vite-env.d.ts（ImportMetaEnv），缺失时直接报字符串错误
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY;

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_KEY');
}

export const supabase = createClient(url, key);
