# Google Search Console & Merchant Center

The store already publishes:

| What | URL |
|---|---|
| Sitemap | `https://<your-domain>/sitemap.xml` |
| Robots | `https://<your-domain>/robots.txt` |
| Product feed (Merchant Center) | `https://<your-domain>/feeds/google-merchant.xml` |
| Product structured data | JSON-LD in `/product` (price, availability, return and shipping policy) |

Nothing is sent to Google automatically: you connect your own accounts.

## 1. Prerequisites
- `PUBLIC_URL` set to the final HTTPS address. Without it the feed answers 503.
  A custom domain is recommended over `*.onrender.com`.
- Real contact details on the site (`STORE_SUPPORT_EMAIL`, `STORE_BUSINESS_NAME`,
  `STORE_BUSINESS_ADDRESS`), and final shipping, returns, privacy and terms pages.
  Merchant Center reviews these.
- Live checkout. Products cannot be approved while the store only takes demo orders.

## 2. Search Console (free)
1. Go to https://search.google.com/search-console and add a **URL-prefix** property
   for your `PUBLIC_URL`.
2. Choose the **HTML tag** method. Copy only the `content` value of
   `<meta name="google-site-verification" content="…">`.
3. Set it on Render: `GOOGLE_SITE_VERIFICATION=<value>`. The tag is added to the home
   page after the redeploy.
4. Click **Verify**, then submit `sitemap.xml` under **Sitemaps**.
5. Check the product page with the Rich Results Test (https://search.google.com/test/rich-results).

## 3. Merchant Center (free listings and Shopping ads)
1. Create an account at https://merchants.google.com. Country of sale: **United States**,
   currency **USD**.
2. **Business info**: add the website, then verify and claim it. Use the same HTML tag
   (`GOOGLE_SITE_VERIFICATION`), or link Search Console.
3. **Shipping**: set the US shipping cost and transit times to match the shipping page.
   Only enter transit times you can actually meet.
4. **Returns**: set the return policy to match `/returns`, a 30-day window by default
   (`RETURN_WINDOW_DAYS`).
5. **Products → Add products → Scheduled fetch**, using the feed URL above. Fetch daily.
6. Check **Diagnostics**. Known points:
   - **GTIN**: the feed sends `identifier_exists = no`, because no GTIN or MPN is on
     record. If the supplier provides a GTIN or brand MPN, add it.
   - **Brand**: the feed uses `STORE_NAME` (HavenLume). Only keep it if you sell the
     product under your own brand; otherwise use the manufacturer's brand.
   - **Images**: Google rejects promotional overlays and watermarks. The current photos
     have none. Use authorised photos of the real product.
   - **Policies**: heated and electrical products can be reviewed more closely. Keep the
     product page factual, and see `docs/PRODUCT_COMPLIANCE.md`.

## 4. Google Analytics 4 (optional, not installed)
The store uses its own cookieless analytics. GA4 is **not** installed. Adding it would
need:
- a GA4 measurement ID;
- the CSP to allow Google's domains;
- consent handled before loading GA4 (`ANALYTICS_CONSENT_MODE=opt-in` recommended);
- a privacy policy update.

The admin dashboard would still read the store's own data. Ask for it as a separate
change if you need GA4 audiences for Google Ads.
