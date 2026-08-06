#!/usr/bin/env python3
"""twikit 桥接：拉取 X 账号最近推文，输出结构化 JSON 到 stdout。
用法: python x-fetch-tweets.py <handle> [<handle>...]
凭证: 环境变量 X_AUTH_TOKEN/X_CT0（cookie，优先）或 X_USERNAME/X_PASSWORD（密码）。
twikit 2.x 为 async API，全部 await。
"""
import asyncio
import json
import os
import sys

# Windows 控制台默认 GBK，推文含 emoji 会 UnicodeEncodeError；强制 UTF-8 输出（Node 侧按 utf8 读）
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

async def build_client():
    from twikit import Client
    # 国内网络需走代理：X_PROXY 优先，回退环境 HTTP(S)_PROXY（Node 侧 dotenv + spawn 会透传）
    proxy = (
        os.environ.get("X_PROXY")
        or os.environ.get("HTTPS_PROXY")
        or os.environ.get("HTTP_PROXY")
        or None
    )
    client = Client("en-US", proxy=proxy)
    cookie_file = os.environ.get("X_COOKIES_FILE", "")
    auth_token = os.environ.get("X_AUTH_TOKEN", "")
    ct0 = os.environ.get("X_CT0", "")
    username = os.environ.get("X_USERNAME", "")
    password = os.environ.get("X_PASSWORD", "")

    if cookie_file and os.path.exists(cookie_file):
        client.load_cookies(cookie_file)
    elif auth_token and ct0:
        client.set_cookies({"auth_token": auth_token, "ct0": ct0})
        if cookie_file:
            client.save_cookies(cookie_file)
    elif username and password:
        await client.login(auth_info_1=username, password=password)
        if cookie_file:
            client.save_cookies(cookie_file)
    else:
        print("ERROR: no X credentials (X_AUTH_TOKEN/X_CT0 or X_USERNAME/X_PASSWORD)", file=sys.stderr)
        sys.exit(2)
    return client

async def fetch_handle(client, handle, limit=20):
    try:
        user = await client.get_user_by_screen_name(handle)
        tweets = await client.get_user_tweets(user.id, tweet_type="Tweets", count=limit)
        rows = []
        for t in tweets or []:
            rows.append({
                "handle": handle,
                "status_id": str(getattr(t, "id", "")),
                "text": getattr(t, "text", "") or "",
                "created_at": getattr(t, "created_at_datetime", None).isoformat() if getattr(t, "created_at_datetime", None) else None,
                "url": f"https://x.com/{handle}/status/{getattr(t, 'id', '')}",
            })
        return rows
    except Exception as e:
        print(f"WARN {handle}: {type(e).__name__}: {e}", file=sys.stderr)
        return []

async def main():
    handles = sys.argv[1:]
    if not handles:
        print("usage: python x-fetch-tweets.py <handle>...", file=sys.stderr)
        sys.exit(1)
    client = await build_client()
    out = []
    for h in handles:
        out.extend(await fetch_handle(client, h))
    print(json.dumps(out, ensure_ascii=False))

if __name__ == "__main__":
    asyncio.run(main())
