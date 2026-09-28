# ProfitPilot AI

Trendyol / Hepsiburada satıcıları için ürün bazında kârlılık analizi.

- `index.html` — landing page (kâr hesaplayıcı + erken erişim)
- `app.html` — uygulama: CSV/Excel sipariş raporu içe aktarma, ürün bazında net kâr, 3 yapay zekâ önerisi
- `main.py` — FastAPI: `/`, `/app.html`, `/health`, `POST /api/analyze` (Claude)

## Çalıştırma

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=...   # asla depoya koyma
uvicorn main:app --reload
```

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Claude API anahtarı (zorunlu, /api/analyze için) |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | Kullanılan model |
| `ALLOWED_ORIGINS` | `*` | CORS izinli kaynaklar (virgülle ayrılmış) |
| `PER_IP_LIMIT` | `5` | IP başına saatlik analiz sınırı |
| `DAILY_CAP` | `200` | Günlük toplam analiz sınırı |

Sınırlar bellekte tutulur; servis yeniden başlayınca sıfırlanır.
