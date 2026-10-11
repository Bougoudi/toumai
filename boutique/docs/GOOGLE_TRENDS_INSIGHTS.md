# Google Trends insights (US) — what we know and what we changed

## How the data was obtained (and its limits)
Google Trends' keyword data can't be queried from the build server: `trends.google.com/trends/api/explore`
answers HTTP 429 to cloud IP addresses (checked 2026-10-11). Only the daily "trending now" RSS feed
answers, and it has no per-keyword data. The owner chose to use **published analyses of Google Trends
data** instead. They are **secondary, directional** sources: they don't always say which country
the index covers, and some are marketing-oriented.

| Finding | Source |
|---|---|
| Searches start rising in **October**, peak in **mid-December**; lowest in **May–July** | SellerSprite, *Electric Blankets Market Report* — https://www.sellersprite.com/en/blog/electric-blanket-report |
| "heated blanket electric" Trends index: **80 in Nov 2025, 89 in Dec 2025, 46 in Jan 2026** | Accio, *Trending heated blanket 2026* — https://www.accio.com/business/trending-heated-blanket-2026 |
| "**heated throw blanket**" keeps higher search interest than "electric heating pad" and "heated mattress pad", peaking in December; May–August lowest | Accio, *Heated blanket electric trends* — https://www.accio.com/business/heated-blanket-electric-trends |
| Wearable heated blankets: more volatile search volume than throws | asinsight — https://www.asinsight.com/report/US/portable-heated-blanket |
| "heated throw blanket" ≈ 28,800 monthly searches (other tool, not Google Trends) | Merchantwords — https://www.merchantwords.com/search/us/healed |

## What was applied to the store
1. **Wording people search for** (only where it is true of our product):
   - home page title → "USB Heated Throw Blanket for Home & Desk";
   - product title and description lead with "USB heated throw blanket";
   - Google Merchant feed titles → "USB Heated Throw Blanket, Wearable – {color}".
2. **Timing**: the content calendar's starter ideas are scheduled for mid-October to late November, the run-up to the
   November–December peak, each with a note explaining why (`src/marketing.js`).
   A new idea answers the most common USB question (power bank or not, 1.5 m cable, automatic shut-off).
3. **Capturing visitors while interest rises**: the e-mail list invitation with a real 10% welcome code
   (one use per subscribed address), so visitors who aren't ready to buy can be reached later in the season.

## Not done (on purpose)
- No countdowns, "selling fast" or "only X left" claims: search interest is not stock or demand for *our* store.
- No claim that the product is "trending" or "best-selling".

## Refreshing with real Google Trends data (5 minutes)
1. Open https://trends.google.com/trends/explore, set **United States**, **Past 5 years**.
2. Compare: `heated throw blanket`, `usb heated blanket`, `wearable blanket`, `heated blanket`.
3. Use the download icon (CSV) on "Interest over time" and "Related queries", and send the files:
   the timing and wording above can then be checked against first-hand data.
