#!/usr/bin/env python3
"""twikit 桥接：拉取 X 账号最近推文，输出结构化 JSON 到 stdout。
用法: python x-fetch-tweets.py <handle> [<handle>...]
凭证: 环境变量 X_AUTH_TOKEN/X_CT0（cookie，优先）或 X_USERNAME/X_PASSWORD（密码）。
"""
import json
import os
import sys

def build_client():
    from twikit import Client
    client = Client("en-US")
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
        client.login(auth_info_1=username, password=password)
        if cookie_file:
            client.save_cookies(cookie_file)
    else:
        print("ERROR: no X credentials (X_AUTH_TOKEN/X_CT0 or X_USERNAME/X_PASSWORD)", file=sys.stderr)
        sys.exit(2)
    return client

def fetch_handle(client, handle, limit=20):
    try:
        user = client.get_user_by_screen_name(handle)
        tweets = client.get_user_tweets(user.id, count=limit)
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
        print(f"WARN {handle}: {e}", file=sys.stderr)
        return []

def main():
    handles = sys.argv[1:]
    if not handles:
        print("usage: python x-fetch-tweets.py <handle>...", file=sys.stderr)
        sys.exit(1)
    client = build_client()
    out = []
    for h in handles:
        out.extend(fetch_handle(client, h))
    print(json.dumps(out, ensure_ascii=False))

if __name__ == "__main__":
    main()
