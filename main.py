"""ProfitPilot AI – API FastAPI.

- GET  /            -> index.html (landing)
- GET  /app.html    -> app.html (application)
- GET  /health      -> état du service
- POST /api/analyze -> 3 recommandations IA (Claude) à partir des chiffres par produit

Limites : PER_IP_LIMIT requêtes par heure et par IP, DAILY_CAP requêtes par jour au total.
"""

import json
import os
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

import anthropic
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent

# Clé API : variable d'environnement, ou « Secret File » Render (/etc/secrets/ANTHROPIC_API_KEY)
if not os.getenv("ANTHROPIC_API_KEY"):
    _secret = Path("/etc/secrets/ANTHROPIC_API_KEY")
    if _secret.is_file():
        _key = _secret.read_text(encoding="utf-8").strip()
        if _key.startswith("ANTHROPIC_API_KEY="):
            _key = _key.split("=", 1)[1].strip()
        if _key:
            os.environ["ANTHROPIC_API_KEY"] = _key.strip("\"'")

ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
PER_IP_LIMIT = int(os.getenv("PER_IP_LIMIT", "5"))
DAILY_CAP = int(os.getenv("DAILY_CAP", "200"))

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
    return {
        "status": "ok",
        "ai_configured": bool(os.getenv("ANTHROPIC_API_KEY")),
        "model": ANTHROPIC_MODEL,
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


@app.get("/")
def index():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/app.html")
def app_page():
    return FileResponse(BASE_DIR / "app.html")


@app.get("/index.html")
def index_html():
    return FileResponse(BASE_DIR / "index.html")
