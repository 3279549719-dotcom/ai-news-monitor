# Dallas Mavericks News Source Research

**Generated:** 2026-08-04 12:12 CST  
**Project:** AI News Monitor - Dallas Mavericks  
**Architecture:** White-list based crawl4ai scraping at `localhost:11235`

---

## Part 1: Web Research - Source Discovery

### Tier 0: Official Sources

| # | Source | URL | Status | Notes |
|---|--------|-----|--------|-------|
| 1 | **NBA.com Mavericks News** | `https://www.nba.com/mavs/news` | ✅ Recommended | Official team news page on NBA.com. This is the canonical URL. |
| 2 | ~~Mavs.com News~~ | `https://www.mavs.com/news` | ❌ Skip | 301 redirect → nba.com/mavs/news. Use destination directly. |

**Note:** `mavs.com/news` → `301 Redirect` → `https://www.nba.com/mavs/news`. The NBA migrated all team sites to nba.com.

---

### Tier 1: Key Journalists / Beat Reporters

These are the top reporters who break and cover Mavs news:

| Journalist | X Handle | Affiliation | Coverage Focus |
|------------|----------|-------------|----------------|
| **Marc Stein** | [@TheSteinLine](https://x.com/TheSteinLine) | The Stein Line (Substack) | NBA insider, Mavs specialist. Based in Dallas. Substack: marcstein.substack.com |
| **Tim MacMahon** | [@espn_macmahon](https://x.com/espn_macmahon) | ESPN | ESPN's designated Mavs beat reporter |
| **Brad Townsend** | [@townbrad](https://x.com/townbrad) | Dallas Morning News | Longtime Mavs beat writer, frequently breaks Mavs news |
| **Callie Caplan** | [@CallieCaplan](https://x.com/CallieCaplan) | Dallas Morning News | Mavs beat writer, game & practice coverage |
| **Mike Curtis** | [@MikeACurtis2](https://x.com/MikeACurtis2) | Dallas Morning News | Mavs beat reporter |
| **Tim Cato** | [@tim_cato](https://x.com/tim_cato) | The Athletic | In-depth Mavs analysis |
| **Grant Afseth** | [@GrantAfseth](https://x.com/GrantAfseth) | SI/FanNation | Mavs coverage for Sports Illustrated |
| **Bobby Karalla** | [@bobbykaralla](https://x.com/bobbykaralla) | Mavs.com (Official) | Official team digital content |
| **Dwain Price** | [@DwainPrice](https://x.com/DwainPrice) | Mavs.com (Official) | Official Mavs reporter |

**National NBA Insiders (break Mavs trades/signings):**
- **Shams Charania** [@ShamsCharania](https://x.com/ShamsCharania) — ESPN, top NBA insider
- **Chris Haynes** [@ChrisBHaynes](https://x.com/ChrisBHaynes) — NBA insider
- **Jake Fischer** [@JakeLFischer](https://x.com/JakeLFischer) — The Stein Line, covers Mavs trades

> ⚠️ **Adrian Wojnarowski (@wojespn) retired in September 2024.** He is no longer active. Shams Charania is now the primary NBA breaking news source.

---

### Tier 2: Sports Media Outlets

| # | Source | URL | Paywall | Verdict |
|---|--------|-----|----------|---------|
| 1 | **Dallas Morning News** | `https://www.dallasnews.com/sports/mavericks/` | Soft paywall | ✅ **HIGHLY RECOMMENDED** |
| 2 | **ESPN Mavs** | `https://www.espn.com/nba/team/_/name/dal/dallas-mavericks` | Free | ❌ Bot detection blocks scraping |
| 3 | **Yahoo Sports Mavs** | `https://sports.yahoo.com/nba/teams/dallas/` | Free | ✅ Recommended |
| 4 | **Bleacher Report Mavs** | `https://bleacherreport.com/dallas-mavericks` | Free | ⚠️ Partial - link discovery only |
| 5 | **Sports Illustrated Mavs** | `https://www.si.com/nba/mavericks` | Free | ❌ JS SPA, markdown extraction fails |
| 6 | **CBS Sports Mavs** | `https://www.cbssports.com/nba/teams/DAL/dallas-mavericks/` | Free | ❌ Heavy anti-bot (406 on direct HTTP) |
| 7 | **The Athletic Mavs** | `https://www.nytimes.com/athletic/nba/team/mavericks/` | Hard paywall | ❌ Paywalled + CDN blocks |
| 8 | **Mavs Moneyball** | `https://www.mavsmoneyball.com/` | Free | ⚠️ Needs testing (SB Nation blog) |
| 9 | **The Smoking Cuban** | `https://thesmokingcuban.com/dallas-mavericks-news/` | Free | ⚠️ Needs testing (FanSided blog) |

---

## Part 2: Reachability Testing Results

### Test Setup
- **Method:** crawl4ai Docker at `localhost:11235/crawl` + direct Node.js HTTPS GET (User-Agent: Chrome 125)
- **Token:** From `E:/claude/ai-news-monitor/.crawl4ai-token`
- **Timeout:** 90s (crawl4ai), 30s (direct)

---

### crawl4ai Results (Detailed)

| URL | Tier | Status | Redirect | Markdown | Int Links | Ext Links | Article Links | Content Quality |
|-----|------|--------|----------|----------|-----------|-----------|---------------|-----------------|
| `nba.com/mavs/news` | 0 | ✅ 200 | same | **27,637** | 90 | 14 | **11** | ✅ Good |
| `mavs.com/news` | 0 | ❌ fail | nba.com/mavs/news | 0 | 0 | 0 | 0 | ⛔ Redirect |
| `x.com/TheSteinLine` | 1 | ✅ 200 | same | 0 | 42 | 4 | 0 | ⚠️ Empty md |
| `x.com/espn_macmahon` | 1 | ✅ 200 | same | 0 | 22 | 1 | 0 | ⚠️ Empty md |
| `x.com/townbrad` | 1 | ✅ 200 | same | 0 | 30 | 3 | 0 | ⚠️ Empty md |
| `x.com/CallieCaplan` | 1 | ✅ 200 | same | 0 | 31 | 1 | 0 | ⚠️ Empty md |
| `espn.com/nba/team/_/name/dal/...` | 2 | ✅ 202 | same | 130 | 0 | 0 | 0 | ❌ Bot block |
| `dallasnews.com/sports/mavericks/` | 2 | ✅ 200 | same | **57,659** | 181 | 14 | **84** | ✅ Excellent |
| `si.com/nba/mavericks` | 2 | ✅ 200 | same | 0 | 82 | 15 | 0 | ❌ Empty md |
| `cbssports.com/nba/teams/DAL/...` | 2 | ✅ 200 | same | 0 | 361 | 51 | 0 | ❌ Empty md |
| `sports.yahoo.com/nba/teams/dallas/` | 2 | ✅ 200 | same | **78,577** | 91 | 9 | **2** | ✅ Good |
| `nytimes.com/athletic/nba/team/mavericks/` | 2 | ✅ 200 | same | 0 | 228 | 8 | 0 | ❌ Paywall |
| `bleacherreport.com/dallas-mavericks` | 2 | ✅ 200 | same | **108,739** | 109 | 77 | 0 | ⚠️ Nav only |

---

### Direct HTTP Results

| URL | HTTP Status | HTML Size | Error |
|-----|------------|-----------|-------|
| `mavs.com/news` | **301** → `nba.com/mavs/news` | 167 B | none |
| `nba.com/mavs/news` | **200** ✅ | 130 KB | none |
| `espn.com/nba/team/_/name/dal/...` | **202** ⚠️ | 2 KB | Bot detection |
| `x.com/TheSteinLine` | **null** ❌ | 0 | TLS RESET |
| `x.com/espn_macmahon` | **null** ❌ | 0 | ECONNRESET |
| `x.com/townbrad` | **null** ❌ | 0 | ECONNRESET |
| `x.com/CallieCaplan` | **null** ❌ | 0 | ECONNRESET |
| `dallasnews.com/sports/mavericks/` | **200** ✅ | 546 KB | none |
| `si.com/nba/mavericks` | **200** ✅ | 702 KB | none |
| `cbssports.com/nba/teams/DAL/...` | **406** ❌ | 0 | Not Acceptable |
| `sports.yahoo.com/nba/teams/dallas/` | **403** ❌ | 3 KB | Forbidden |
| `nytimes.com/athletic/nba/team/mavericks/` | **null** ❌ | 0 | ETIMEDOUT |
| `bleacherreport.com/dallas-mavericks` | **403** ❌ | 193 KB | Forbidden |

---

## Recommended White-List (Priority Order)

### 1️⃣ NBA.com Mavericks News (Tier 0)
- **URL:** `https://www.nba.com/mavs/news`
- **crawl4ai:** ✅ 200, 27KB markdown, 11 article links
- **Direct HTTP:** ✅ 200, 130KB HTML
- **Verdict:** **PRIMARY SOURCE** — Official team news. Most reliable.

### 2️⃣ Dallas Morning News - Mavericks (Tier 2)
- **URL:** `https://www.dallasnews.com/sports/mavericks/`
- **crawl4ai:** ✅ 200, **57KB markdown, 84 article links!**
- **Direct HTTP:** ✅ 200, 546KB HTML, 108 article links detected
- **Verdict:** **BEST NON-OFFICIAL SOURCE** — Incredible article density. Local coverage.

### 3️⃣ Yahoo Sports - Mavericks (Tier 2)
- **URL:** `https://sports.yahoo.com/nba/teams/dallas/`
- **crawl4ai:** ✅ 200, 78KB markdown, 2 article links
- **Direct HTTP:** ❌ 403 (but crawl4ai works!)
- **Verdict:** Good supplemental source. Reachable via crawl4ai despite direct HTTP block.

### 4️⃣ Bleacher Report - Mavericks (Tier 2)
- **URL:** `https://bleacherreport.com/dallas-mavericks`
- **crawl4ai:** ✅ 200, 109KB markdown, **77 external links**
- **Direct HTTP:** ❌ 403 (but crawl4ai works)
- **Verdict:** Useful for **link discovery**. External links point to Mavs blogs (thesmokingcuban.com, mavsmoneyball.com).

### 5️⃣ Mavs Moneyball (SB Nation) (Tier 2)
- **URL:** `https://www.mavsmoneyball.com/`
- **crawl4ai:** ⚠️ Needs testing
- **Verdict:** Active community blog. Worth adding based on Bleacher Report external link patterns.

### 6️⃣ Marc Stein Substack (Tier 1)
- **URL:** `https://marcstein.substack.com`
- **Verdict:** Top Mavs journalist. Substack is generally scraper-friendly. Needs testing.

---

## Sources NOT Recommended (with reasons)

| URL | Reason |
|-----|--------|
| `espn.com/nba/team/_/name/dal/...` | Bot detection returns 202 with empty page. ESPN blocks automation. |
| `si.com/nba/mavericks` | JS-heavy SPA. crawl4ai gets 200 but markdown extraction is empty despite 702KB HTML. |
| `cbssports.com/nba/teams/DAL/...` | Heavy anti-bot: 406 on direct HTTP, empty markdown via crawl4ai. |
| `nytimes.com/athletic/nba/team/mavericks/` | Hard paywall + CDN times out direct HTTP. Empty markdown via crawl4ai. |
| `mavs.com/news` | 301 redirect. Use `nba.com/mavs/news` directly instead. |

---

## X.com / Twitter Strategy

**Problem:** X.com profiles are JS-rendered SPAs that:
- Block direct HTTP connections (TLS reset, ECONNRESET)
- Return empty markdown via crawl4ai (JS content not rendered into DOM text)
- Only provide profile-level links, not tweet content

**Recommendation:** For monitoring X/Twitter journalists, consider these alternatives:
1. **Nitter instances** — RSS/HTML mirrors of X profiles. Example: `https://nitter.net/TheSteinLine/rss`
2. **X API v2 (Paid)** — Official API for tweet timeline access. Basic tier ~$100/mo.
3. **RSS bridges** — Tools like `rss-bridge` can generate RSS from X profiles.
4. **Third-party aggregators** — Sites like `nbaaggregator.com` or `hoopshype.com` that aggregate NBA reporter tweets.

**Affected journalists (X only, no alternative feed):**
- Marc Stein (`x.com/TheSteinLine`) — also has Substack
- Tim MacMahon (`x.com/espn_macmahon`)
- Brad Townsend (`x.com/townbrad`) — also publishes on dallasnews.com
- Callie Caplan (`x.com/CallieCaplan`) — also publishes on dallasnews.com

---

## crawl4ai API Reference

**Endpoint:** `POST http://localhost:11235/crawl`

**Headers:**
```
Authorization: Bearer <token-from-.crawl4ai-token>
Content-Type: application/json
```

**Request:**
```json
{
  "urls": ["https://www.nba.com/mavs/news"],
  "max_pages_to_crawl": 1
}
```

**Response Structure:**
```json
{
  "success": true,
  "results": [
    {
      "url": "https://www.nba.com/mavs/news",
      "status_code": 200,
      "redirected_url": "https://www.nba.com/mavs/news",
      "markdown": {
        "raw_markdown": "...",
        "markdown_with_citations": "...",
        "references_markdown": "...",
        "fit_markdown": "..."
      },
      "links": {
        "internal": ["https://www.nba.com/...", ...],
        "external": ["https://...", ...]
      },
      "metadata": { "title": "...", "description": "..." },
      "cleaned_html": "...",
      "extracted_content": "..."
    }
  ],
  "server_processing_time_s": 5.2
}
```

---

## Summary Statistics

- **Total URLs tested:** 13
- **crawl4ai reachable (200):** 12/13 (92%)
- **crawl4ai with usable markdown content:** 4/13 (31%)
- **Direct HTTP reachable (200):** 4/13 (31%)
- **Sources RECOMMENDED for whitelist:** 5
- **Sources REJECTED:** 5
- **Sources needing further testing:** 3

**Key finding:** crawl4ai is far more effective than direct HTTP for bot-protected sites (Yahoo, Bleacher Report) but cannot overcome JS-heavy SPAs (SI, X.com) or hard paywalls (The Athletic). Dallas Morning News and NBA.com are the standout sources with rich article content.
