"""ProfitPilot AI – API FastAPI.

- GET  /            -> index.html (landing)
- GET  /app.html    -> app.html (application)
- GET  /health      -> état du service
- POST /api/analyze -> 3 recommandations IA (Claude) à partir des chiffres par produit
- POST /api/waitlist -> inscription à la liste d'attente
- GET  /admin        -> liste des inscrits (protégée par ADMIN_TOKEN), export CSV

Limites : PER_IP_LIMIT requêtes par heure et par IP, DAILY_CAP requêtes par jour au total.
"""

import hmac
import html
import json
import logging
import os
import re
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

import anthropic
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from pydantic import BaseModel, Field

import waitlist

BASE_DIR = Path(__file__).resolve().parent
log = logging.getLogger("profitpilot")

# Secrets : variable d'environnement, ou « Secret File » Render (/etc/secrets/<NOM>)
for _name in ("ANTHROPIC_API_KEY", "DATABASE_URL"):
    if os.getenv(_name):
        continue
    _secret = Path("/etc/secrets") / _name
    if _secret.is_file():
        _val = _secret.read_text(encoding="utf-8").strip()
        if _val.startswith(_name + "="):
            _val = _val.split("=", 1)[1].strip()
        if _val:
            os.environ[_name] = _val.strip("\"'")

ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
PER_IP_LIMIT = int(os.getenv("PER_IP_LIMIT", "5"))
DAILY_CAP = int(os.getenv("DAILY_CAP", "200"))
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
WAITLIST_PER_IP = 10  # inscriptions max par heure et par IP (anti-spam)

app = FastAPI(title="ProfitPilot AI", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# --------------------------------------------------------------------------- #
# Limites d'usage (en mémoire : remises à zéro au redémarrage du service)
# --------------------------------------------------------------------------- #
_lock = threading.Lock()
_ip_hits: dict[str, deque] = defaultdict(deque)
_daily = {"day": "", "count": 0}
_wl_hits: dict[str, deque] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    # Render place l'IP réelle du client en tête de X-Forwarded-For
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_limits(ip: str) -> None:
    now = time.time()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with _lock:
        if _daily["day"] != today:
            _daily["day"], _daily["count"] = today, 0
        if _daily["count"] >= DAILY_CAP:
            raise HTTPException(429, "Günlük analiz kapasitesi doldu. Yarın tekrar dene.")
        hits = _ip_hits[ip]
        while hits and now - hits[0] > 3600:
            hits.popleft()
        if len(hits) >= PER_IP_LIMIT:
            wait_min = int((3600 - (now - hits[0])) // 60) + 1
            raise HTTPException(429, f"Saatlik analiz sınırına ulaştın. {wait_min} dakika sonra tekrar dene.")
        hits.append(now)
        _daily["count"] += 1


def _check_waitlist_limit(ip: str) -> None:
    now = time.time()
    with _lock:
        hits = _wl_hits[ip]
        while hits and now - hits[0] > 3600:
            hits.popleft()
        if len(hits) >= WAITLIST_PER_IP:
            raise HTTPException(429, "Çok fazla deneme. Biraz sonra tekrar dene.")
        hits.append(now)


# --------------------------------------------------------------------------- #
# Modèles de requête
# --------------------------------------------------------------------------- #
class Product(BaseModel):
    name: str = Field(max_length=200)
    units: float = Field(ge=0)
    revenue: float
    cost: float
    commission: float
    shipping: float
    fees: float
    ads: float
    returns_loss: float
    vat: float
    stopaj: float = 0
    net_profit: float
    margin_pct: float


class AnalyzeRequest(BaseModel):
    marketplace: str = Field(default="Trendyol", max_length=40)
    products: list[Product] = Field(min_length=1, max_length=60)


class WaitlistRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    store: str = Field(min_length=1, max_length=150)
    phone: str = Field(min_length=1, max_length=30)
    monthly_sales: str = Field(default="", max_length=50)
    source: str = Field(default="", max_length=50)


RECO_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "recommendations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "product": {"type": "string"},
                    "action": {
                        "type": "string",
                        "enum": ["fiyat_artir", "reklami_azalt", "maliyeti_dusur", "satistan_cek", "one_cikar"],
                    },
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                    "monthly_impact_try": {"type": "number"},
                },
                "required": ["product", "action", "title", "detail", "monthly_impact_try"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "recommendations"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """Sen Türk pazaryeri (Trendyol, Hepsiburada) satıcıları için çalışan bir kârlılık danışmanısın.
Sana bir mağazanın ürün bazında gerçek rakamları verilecek (komisyon, kargo, iade, KDV, %1 stopaj ve reklam düşülmüş net kâr).
Görevin: mağazanın kârını en çok artıracak TAM OLARAK 3 somut öneri vermek.

Kurallar:
- Türkçe yaz, sade ve doğrudan ol. Satıcıya "sen" diye hitap et.
- Her öneri tek bir ürüne ve tek bir eyleme odaklansın; ürün adını verilen listeden aynen kullan.
- Rakamlara dayan: öneriyi hangi kalemin (komisyon, kargo, reklam, iade, maliyet) bozduğunu söyleyerek gerekçelendir.
- monthly_impact_try: öneri uygulanırsa aylık net kâra yaklaşık etkisi (₺). Verilen satış adedine göre makul ve temkinli hesapla.
- Fiyat artışı önerirken yüzde veya hedef fiyat ver; satıştan çekme önerisini yalnızca ürün zarar ediyorsa ve düzeltilemiyorsa yap.
- summary: mağazanın genel durumunu anlatan en fazla 2 cümle.
- Rakamları uydurma; yalnızca verilen verileri kullan."""


_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic()
    return _client


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get("/health")
def health():
    key = os.getenv("ANTHROPIC_API_KEY", "")
    return {
        "status": "ok",
        "ai_configured": bool(key),
        # diagnostic sans exposer la clé : préfixe attendu et longueur
        "key_format_ok": key.startswith("sk-ant-") and " " not in key,
        "key_length": len(key),
        "model": ANTHROPIC_MODEL,
        "waitlist_storage": waitlist.storage_kind(),
    }


@app.post("/api/analyze")
async def analyze(body: AnalyzeRequest, request: Request):
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(503, "Yapay zekâ analizi henüz yapılandırılmadı.")
    _check_limits(_client_ip(request))

    data = {
        "pazaryeri": body.marketplace,
        "urunler": [p.model_dump() for p in body.products],
    }
    try:
        response = await _get_client().messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": RECO_SCHEMA}},
            messages=[{
                "role": "user",
                "content": "Mağaza verileri (tutarlar ₺, adetler dönem toplamı):\n"
                + json.dumps(data, ensure_ascii=False),
            }],
        )
    except anthropic.RateLimitError:
        raise HTTPException(503, "Yapay zekâ servisi şu an yoğun. Birkaç dakika sonra tekrar dene.")
    except anthropic.AuthenticationError:
        raise HTTPException(503, "Yapay zekâ anahtarı geçersiz. Yönetici ile iletişime geç.")
    except anthropic.APIStatusError as e:
        log.error("Anthropic API %s: %s", e.status_code, e.message)
        if "credit balance" in str(e.message).lower():
            raise HTTPException(503, "Yapay zekâ hesabında kredi yok. Yönetici bakiye eklemeli.")
        raise HTTPException(502, f"Yapay zekâ servisi hata verdi ({e.status_code}).")
    except anthropic.APIConnectionError:
        raise HTTPException(502, "Yapay zekâ servisine ulaşılamadı.")

    if response.stop_reason == "refusal":
        raise HTTPException(422, "Bu veriler için öneri üretilemedi.")
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        raise HTTPException(502, "Yapay zekâ yanıtı okunamadı. Tekrar dene.")
    result["recommendations"] = result.get("recommendations", [])[:3]
    return result


@app.post("/api/waitlist")
def join_waitlist(body: WaitlistRequest, request: Request):
    phone = re.sub(r"[^\d+]", "", body.phone)
    if len(re.sub(r"\D", "", phone)) < 10:
        raise HTTPException(422, "Geçerli bir telefon numarası yaz (ör. 05xx xxx xx xx).")
    _check_waitlist_limit(_client_ip(request))
    try:
        added = waitlist.add(body.name.strip(), body.store.strip(), phone,
                             body.monthly_sales.strip(), body.source.strip())
    except Exception:
        log.exception("waitlist insert failed")
        raise HTTPException(503, "Kayıt şu an yapılamadı. Lütfen WhatsApp'tan yaz.")
    return {"ok": True, "already": not added}


def _wa_number(phone: str) -> str:
    """Numéro au format international sans + pour wa.me (05xx… → 905xx…)."""
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("0"):
        return "90" + digits[1:]
    if len(digits) == 10 and digits.startswith("5"):
        return "90" + digits
    return digits


def _require_admin(token: str) -> None:
    if not ADMIN_TOKEN or not hmac.compare_digest(token.encode(), ADMIN_TOKEN.encode()):
        raise HTTPException(404, "Not Found")


@app.get("/admin/waitlist.csv")
def admin_csv(token: str = ""):
    _require_admin(token)
    return Response(
        waitlist.to_csv(waitlist.all_rows()),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="profitpilot-bekleme-listesi.csv"'},
    )


@app.get("/admin", response_class=HTMLResponse)
def admin(token: str = ""):
    _require_admin(token)
    rows = waitlist.all_rows()
    e = html.escape
    body_rows = "".join(
        "<tr>" + "".join(f"<td>{e(str(r[k]))}</td>" for k in waitlist.FIELDS)
        + f'<td><a href="https://wa.me/{_wa_number(r["phone"])}">WhatsApp</a></td></tr>'
        for r in rows
    )
    storage = waitlist.storage_kind()
    warn = "" if storage == "postgres" else (
        '<p class="warn">⚠ Base de données non connectée (DATABASE_URL manquant) : '
        "les inscriptions seront perdues au prochain redéploiement.</p>"
    )
    return f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Liste d'attente</title>
<style>
:root{{--bg:#E8ECF1;--ink:#16223A;--muted:#56637A;--paper:#fff;--line:#C7D0DB;--green:#0E7A5A;--red:#C8102E}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0F1726;--ink:#E7ECF3;--muted:#9AA6BA;--paper:#18233A;--line:#2D3B56;--green:#3DCB98;--red:#FF5B6F}}}}
body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}}
.wrap{{max-width:1100px;margin:0 auto;padding:20px 16px}}
h1{{margin:0 0 4px;font-size:26px}} .big{{font-size:40px;font-weight:800;color:var(--green)}}
.muted{{color:var(--muted)}} .warn{{color:var(--red);font-weight:600}}
a{{color:var(--green)}} .tw{{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--paper);margin-top:14px}}
table{{border-collapse:collapse;width:100%;min-width:760px}} th,td{{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}}
th{{font-size:12px;color:var(--muted)}}
</style></head><body><div class="wrap">
<h1>Liste d'attente ProfitPilot</h1>
<div class="big">{len(rows)} <span class="muted" style="font-size:16px;font-weight:400">inscrits · objectif 100</span></div>
{warn}
<p><a href="/admin/waitlist.csv?token={e(token)}">Télécharger en CSV (Excel)</a></p>
<div class="tw"><table><thead><tr><th>Date (UTC)</th><th>Nom</th><th>Boutique</th><th>Téléphone</th><th>Ventes/mois</th><th>Source</th><th></th></tr></thead>
<tbody>{body_rows or '<tr><td colspan="7" class="muted">Aucun inscrit pour le moment.</td></tr>'}</tbody></table></div>
</div></body></html>"""


@app.get("/")
def index():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/app.html")
def app_page():
    return FileResponse(BASE_DIR / "app.html")


@app.get("/index.html")
def index_html():
    return FileResponse(BASE_DIR / "index.html")
