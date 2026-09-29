"""ProfitPilot AI – API FastAPI.

- GET  /            -> index.html (landing)
- GET  /app.html    -> app.html (application)
- GET  /health      -> état du service
- POST /api/analyze -> 3 recommandations IA (Claude) à partir des chiffres par produit
- POST /api/waitlist -> demande (audit, suivi, agence)
- POST /api/trial    -> démarre l'essai gratuit (nom, boutique, WhatsApp) ; GET /api/trial/{jeton}
- POST /api/support  -> assistant d'aide ; ce qu'il ne résout pas devient un ticket + message WhatsApp
- POST /api/trendyol/sync -> commandes + commissions réelles via l'API Trendyol (identifiants non stockés)
- POST /api/trendyol/connect | GET /api/trendyol/connection | POST /api/trendyol/disconnect
                     -> connexion enregistrée (chiffrée) pour la synchronisation de nuit
- POST /api/cron/sync -> synchronisation de nuit de toutes les connexions (en-tête X-Cron-Secret)
- POST /api/event    -> compteur anonyme de l'entonnoir (visites, imports, analyses)
- GET  /admin        -> entonnoir + liste des inscrits (protégée par ADMIN_TOKEN), export CSV

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
from datetime import datetime, timedelta, timezone
from pathlib import Path

import anthropic
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from pydantic import BaseModel, Field

import connections
import metrics
import trendyol
import waitlist

BASE_DIR = Path(__file__).resolve().parent
log = logging.getLogger("profitpilot")

# Secrets : variable d'environnement, ou « Secret File » Render (/etc/secrets/<NOM>)
for _name in ("ANTHROPIC_API_KEY", "DATABASE_URL", "SYNC_ENC_KEY", "CRON_SECRET"):
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
CRON_SECRET = os.getenv("CRON_SECRET", "")
WAITLIST_PER_IP = 10  # inscriptions max par heure et par IP (anti-spam)
PLANS = {"deneme": "Essai (sans plan choisi)", "baslangic": "Başlangıç 249 ₺/mois", "pro": "Pro 499 ₺/mois",
         "isletme": "İşletme 999 ₺/mois", "denetim": "Audit 1 990 ₺", "takip": "Suivi (ancien)",
         "ajans": "Agence (devis)"}
TRIAL_DAYS = 14
SUPPORT_PER_IP = 12  # questions à l'assistant max par heure et par IP
SYNC_PER_IP = 8      # synchronisations Trendyol max par heure et par IP
EVENTS_PER_IP = 60    # événements max par heure et par IP (anti-gonflage des compteurs)

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
_ev_hits: dict[str, deque] = defaultdict(deque)
_sp_hits: dict[str, deque] = defaultdict(deque)
_sy_hits: dict[str, deque] = defaultdict(deque)


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


def _under_hourly_limit(store: dict[str, deque], ip: str, limit: int) -> bool:
    """Enregistre un passage et indique s'il reste sous `limit` par heure pour cette IP."""
    now = time.time()
    with _lock:
        hits = store[ip]
        while hits and now - hits[0] > 3600:
            hits.popleft()
        if len(hits) >= limit:
            return False
        hits.append(now)
        return True


def _check_waitlist_limit(ip: str) -> None:
    if not _under_hourly_limit(_wl_hits, ip, WAITLIST_PER_IP):
        raise HTTPException(429, "Çok fazla deneme. Biraz sonra tekrar dene.")


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
    token: str = Field(default="", max_length=64)
    marketplace: str = Field(default="Trendyol", max_length=40)
    products: list[Product] = Field(min_length=1, max_length=60)


class EventRequest(BaseModel):
    name: str = Field(max_length=40)
    source: str = Field(default="site", max_length=50)


class TrialRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    store: str = Field(min_length=1, max_length=150)
    phone: str = Field(min_length=1, max_length=30)
    source: str = Field(default="", max_length=50)
    plan: str = Field(default="", max_length=20)   # plan choisi sur la landing (?plan=pro)


class TrendyolSyncRequest(BaseModel):
    token: str = Field(default="", max_length=64)
    store: str = Field(default="Mağazam", min_length=1, max_length=40)
    seller_id: str = Field(min_length=1, max_length=20)
    api_key: str = Field(min_length=4, max_length=100)
    api_secret: str = Field(min_length=4, max_length=100)
    days: int = Field(default=30, ge=1, le=30)

    def __repr__(self) -> str:  # ne jamais afficher les identifiants dans un journal
        return f"TrendyolSyncRequest(seller_id={self.seller_id!r}, days={self.days})"

    __str__ = __repr__


class StoreRef(BaseModel):
    token: str = Field(max_length=64)
    store: str = Field(default="Mağazam", min_length=1, max_length=40)


class SupportRequest(BaseModel):
    token: str = Field(default="", max_length=64)
    question: str = Field(min_length=3, max_length=1500)
    context: str = Field(default="", max_length=1500)   # état de l'écran (fichier chargé, colonnes…)
    escalate: bool = False                               # « pas résolu » : aller directement au ticket
    ai_answer: str = Field(default="", max_length=4000)  # réponse déjà donnée, jointe au ticket


class WaitlistRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    store: str = Field(min_length=1, max_length=150)
    phone: str = Field(min_length=1, max_length=30)
    monthly_sales: str = Field(default="", max_length=50)
    source: str = Field(default="", max_length=50)
    plan: str = Field(default="", max_length=20)


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


SUPPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "needs_human": {"type": "boolean"},
    },
    "required": ["answer", "needs_human"],
    "additionalProperties": False,
}

SUPPORT_PROMPT = """Sen ProfitPilot'un destek asistanısın. ProfitPilot, Trendyol ve Hepsiburada satıcılarının sipariş
raporunu (Excel/CSV) tarayıcıda analiz edip ürün bazında net kârı hesaplayan bir araçtır. Kısa, net, Türkçe cevap ver.

Aracın nasıl çalıştığı (yalnızca bunlara dayan):
- Rapor yükleme: CSV veya Excel. Gerekli sütunlar: ürün adı, adet, satış tutarı. İsteğe bağlı: komisyon tutarı, maliyet,
  sipariş/paket no, sipariş durumu, kargo tutarı, hizmet bedeli. Sütunlar otomatik tanınır; "Sütun eşleştirme" kartından
  elle düzeltilebilir. Dosya sunucuya gönderilmez, tarayıcıda işlenir.
- Maliyet sütunu birim maliyet ya da satır toplamı olabilir; araç otomatik algılar, "Maliyet sütunu ne gösteriyor?"
  menüsünden değiştirilebilir. Maliyeti olmayan ürünlerde fiyatın ayarlardaki yüzdesi tahmin edilir (turuncu kutu);
  tabloda gerçek birim maliyet yazılabilir.
- Hesap: Net kâr = Ciro − maliyet − komisyon − kargo − hizmet bedeli − reklam − iade kaybı − ödenecek KDV − stopaj.
  Komisyon dosyada yoksa ciro × komisyon oranı. Kargo ve hizmet bedeli sipariş (paket) başına; aynı paketteki ürünler
  kargoyu fiyat oranında paylaşır. İptal edilen siparişler hariç tutulur; durum sütununda "iade" olanlar gerçek iade
  sayılır (komisyon sayılmaz, kargo kaybı eklenir), yoksa iade oranıyla tahmin edilir. KDV: (ciro − giderler) × KDV/(1+KDV).
  Stopaj: KDV hariç ciro × %1.
- "Hesaplama kaynakları" satırı hangi değerin dosyadan, hangisinin ayarlardan geldiğini gösterir.
  "Veri kontrolü" kartı şüpheli verileri ve güvenilirlik seviyesini gösterir.
- Hedef fiyat: ayarlardaki hedef marja ulaşmak için gereken satış fiyatı.
- Trendyol'dan otomatik çek: Satıcı ID, API Key, API Secret (Satıcı Paneli → Hesap Bilgilerim → Entegrasyon
  Bilgileri, yalnızca ana kullanıcı görür) ile son 30 güne kadar siparişler ve cari hesaptaki gerçek komisyonlar gelir.
  Salt okunurdur. "Her gece otomatik güncelle" işaretliyse API bilgileri şifrelenerek saklanır ve mağaza her gece
  (Türkiye saatiyle 03:00) otomatik güncellenir; "Şimdi güncelle" ile anında, "Bağlantıyı kaldır" ile bilgiler silinir.
  İşaretli değilse bilgiler hiç saklanmaz. Henüz cari hesaba düşmemiş siparişlerde komisyon ayarlardaki oranla tamamlanır.
- Kampanya simülatörü: tüm ürünlerde % indirim yapılırsa aynı adetle net kârın ne olacağını ve kârı korumak için
  satışın ne kadar artması gerektiğini gösterir.
- Birden fazla mağaza: "Mağaza ekle" ile her mağazanın ayarları, maliyetleri ve Trendyol bilgileri ayrı tutulur.
- Excel olarak indir: özet + ürün tablosu. Yapay zekâ önerileri: kârı en çok artıracak 3 aksiyon.
- Deneme 14 gün ücretsiz. Abonelik: Başlangıç 249 ₺/ay, Pro 499 ₺/ay, İşletme 999 ₺/ay. Uzman denetimi 1.990 ₺.
  Ödeme şu an WhatsApp üzerinden (IBAN veya ödeme linki) yapılır.

Kurallar:
- Emin olmadığın hiçbir şeyi uydurma. Trendyol/Hepsiburada panelindeki menü yollarını bilmiyorsan bilmediğini söyle.
- needs_human = true: ödeme, abonelik, fatura, hesap sorunları; hata/bozukluk bildirimi; kullanıcının verisine özel
  yorum isteyen veya senin çözemeyeceğin her şey. Bu durumda answer'da ekibin WhatsApp'tan döneceğini söyle.
- needs_human = false: yalnızca yukarıdaki bilgilerle soruyu tam çözdüysen."""


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
        "db_host": waitlist.db_host(),
    }


@app.post("/api/analyze")
async def analyze(body: AnalyzeRequest, request: Request):
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(503, "Yapay zekâ analizi henüz yapılandırılmadı.")
    _require_trial(body.token)
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
        plan = body.plan if body.plan in PLANS else ""
        added = waitlist.add(body.name.strip(), body.store.strip(), phone,
                             body.monthly_sales.strip(), body.source.strip(), plan)
    except Exception:
        log.exception("waitlist insert failed")
        raise HTTPException(503, "Kayıt şu an yapılamadı. Lütfen WhatsApp'tan yaz.")
    return {"ok": True, "already": not added}


def _trial_state(t: dict) -> dict:
    started = t["trial_at"]
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    days_left = TRIAL_DAYS - (now - started).days
    paid_until = t.get("paid_until")
    if paid_until and paid_until.tzinfo is None:
        paid_until = paid_until.replace(tzinfo=timezone.utc)
    paid = bool(paid_until and paid_until > now)
    return {"active": days_left > 0 or paid, "paid": paid,
            "days_left": max(0, (paid_until - now).days + 1) if paid else max(0, days_left),
            "name": t["name"], "store": t["store"]}


def _require_trial(token: str) -> dict:
    try:
        t = waitlist.trial_by_token(token)
    except Exception:
        log.exception("trial lookup failed")
        raise HTTPException(503, "Şu an doğrulama yapılamıyor. Biraz sonra tekrar dene.")
    if not t:
        raise HTTPException(401, "Önce ücretsiz denemeyi başlat.")
    state = _trial_state(t)
    if not state["active"]:
        raise HTTPException(402, "Deneme süren doldu. Devam etmek için WhatsApp'tan bize yaz.")
    return t


@app.post("/api/trial")
def start_trial(body: TrialRequest, request: Request):
    phone = re.sub(r"[^\d+]", "", body.phone)
    if len(re.sub(r"\D", "", phone)) < 10:
        raise HTTPException(422, "Geçerli bir WhatsApp numarası yaz (ör. 05xx xxx xx xx).")
    _check_waitlist_limit(_client_ip(request))
    try:
        plan = body.plan if body.plan in ("baslangic", "pro", "isletme") else "deneme"
        token, _ = waitlist.start_trial(body.name.strip(), body.store.strip(), phone, body.source.strip(), plan)
        state = _trial_state(waitlist.trial_by_token(token))
    except Exception:
        log.exception("trial start failed")
        raise HTTPException(503, "Kayıt şu an yapılamadı. Lütfen WhatsApp'tan yaz.")
    # on renvoie le nom saisi, jamais celui en base : un numéro ne doit pas révéler son propriétaire
    return {"token": token, **state, "name": body.name.strip(), "store": body.store.strip()}


@app.get("/api/trial/{token}")
def trial_status(token: str):
    try:
        t = waitlist.trial_by_token(token[:64])
    except Exception:
        log.exception("trial lookup failed")
        raise HTTPException(503, "Şu an doğrulama yapılamıyor.")
    if not t:
        raise HTTPException(404, "Deneme bulunamadı.")
    return _trial_state(t)


@app.post("/api/support")
async def support(body: SupportRequest, request: Request):
    """L'assistant répond ; s'il ne peut pas résoudre (ou si le client le demande), un ticket est créé
    et le client reçoit un message WhatsApp prêt à envoyer au propriétaire."""
    if not _under_hourly_limit(_sp_hits, _client_ip(request), SUPPORT_PER_IP):
        raise HTTPException(429, "Çok fazla soru gönderildi. Biraz sonra tekrar dene ya da WhatsApp'tan yaz.")
    who = None
    try:
        who = waitlist.trial_by_token(body.token)
    except Exception:
        log.exception("trial lookup failed")

    answer, needs_human = body.ai_answer, True
    if not body.escalate and os.getenv("ANTHROPIC_API_KEY"):
        try:
            response = await _get_client().messages.create(
                model=ANTHROPIC_MODEL,
                max_tokens=4000,
                system=SUPPORT_PROMPT,
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": SUPPORT_SCHEMA}},
                messages=[{"role": "user", "content":
                           f"Kullanıcının ekran durumu: {body.context or '-'}\n\nSoru: {body.question}"}],
            )
            if response.stop_reason != "refusal":
                text = next((b.text for b in response.content if b.type == "text"), "")
                data = json.loads(text)
                answer, needs_human = data["answer"], bool(data["needs_human"])
        except (anthropic.APIError, json.JSONDecodeError, KeyError) as e:
            log.error("support AI failed: %s", e)   # l'humain prend le relais

    result = {"answer": answer, "needs_human": needs_human, "ticket_id": None, "whatsapp_text": ""}
    if needs_human:
        try:
            tid = waitlist.add_ticket(body.token if who else "", body.question, answer)
        except Exception:
            log.exception("ticket insert failed")
            tid = None
        who_line = f"{who['name']} – {who['store']}" if who else "Deneme kaydı yok"
        result.update(
            ticket_id=tid,
            answer=answer or "Sorunu ekibimize iletiyoruz. Aşağıdaki butonla WhatsApp'tan gönder, en kısa sürede dönelim.",
            whatsapp_text=(f"ProfitPilot destek talebi{' #' + str(tid) if tid else ''}\n{who_line}\n"
                           f"Sorun: {body.question}"),
        )
    return result


@app.post("/api/trendyol/sync")
def trendyol_sync(body: TrendyolSyncRequest, request: Request):
    _require_trial(body.token)
    if not _under_hourly_limit(_sy_hits, _client_ip(request), SYNC_PER_IP):
        raise HTTPException(429, "Saatlik senkronizasyon sınırına ulaştın. Biraz sonra tekrar dene.")
    try:
        return trendyol.sync(body.seller_id, body.api_key, body.api_secret, body.days)
    except trendyol.TrendyolError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        log.error("trendyol sync failed: %s", type(e).__name__)   # sans détail : pas d'identifiants dans les logs
        raise HTTPException(502, "Trendyol verisi alınamadı. Biraz sonra tekrar dene.")


@app.post("/api/trendyol/connect")
def trendyol_connect(body: TrendyolSyncRequest, request: Request):
    """Vérifie les identifiants par une vraie synchronisation, puis les enregistre chiffrés."""
    _require_trial(body.token)
    if not connections.available():
        raise HTTPException(503, "Otomatik güncelleme şu an kullanılamıyor. Siparişleri elle çekebilirsin.")
    if not _under_hourly_limit(_sy_hits, _client_ip(request), SYNC_PER_IP):
        raise HTTPException(429, "Saatlik senkronizasyon sınırına ulaştın. Biraz sonra tekrar dene.")
    try:
        data = trendyol.sync(body.seller_id, body.api_key, body.api_secret, body.days)
        connections.save(body.token, body.store, body.seller_id.strip(), body.api_key.strip(),
                         body.api_secret.strip(), data)
    except trendyol.TrendyolError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        log.error("trendyol connect failed: %s", type(e).__name__)
        raise HTTPException(502, "Bağlantı kaydedilemedi. Biraz sonra tekrar dene.")
    return {**data, "connected": True, "last_sync_at": connections.now_iso()}


@app.get("/api/trendyol/connection")
def trendyol_connection(token: str = "", store: str = "Mağazam"):
    if not connections.available():
        return {"connected": False, "available": False}
    try:
        if not waitlist.trial_by_token(token[:64]):
            raise HTTPException(401, "Önce ücretsiz denemeyi başlat.")
        c = connections.get_snapshot(token[:64], store[:40])
    except HTTPException:
        raise
    except Exception:
        log.exception("connection lookup failed")
        raise HTTPException(503, "Şu an okunamıyor.")
    if not c:
        return {"connected": False, "available": True}
    return {"connected": True, "available": True, **c}


@app.post("/api/trendyol/refresh")
def trendyol_refresh(body: StoreRef, request: Request):
    """Resynchronise tout de suite avec les identifiants enregistrés."""
    _require_trial(body.token)
    if not _under_hourly_limit(_sy_hits, _client_ip(request), SYNC_PER_IP):
        raise HTTPException(429, "Saatlik senkronizasyon sınırına ulaştın. Biraz sonra tekrar dene.")
    try:
        c = connections.get_creds(body.token, body.store) if connections.available() else None
    except Exception:
        log.exception("refresh lookup failed")
        raise HTTPException(503, "Şu an okunamıyor.")
    if not c:
        raise HTTPException(404, "Bu mağaza için kayıtlı Trendyol bağlantısı yok.")
    if not c["creds"]:
        raise HTTPException(409, "Bağlantıyı yeniden kurman gerekiyor.")
    try:
        data = trendyol.sync(c["seller_id"], c["creds"]["k"], c["creds"]["s"], 30)
        connections.record_result(body.token, body.store, "ok", data)
    except trendyol.TrendyolError as e:
        connections.record_result(body.token, body.store,
                                  "bilgiler reddedildi" if "reddedildi" in str(e) else "Trendyol hatası", None)
        raise HTTPException(502, str(e))
    return {**data, "connected": True, "last_sync_at": connections.now_iso()}


@app.post("/api/trendyol/disconnect")
def trendyol_disconnect(body: StoreRef):
    if not waitlist.trial_by_token(body.token):
        raise HTTPException(401, "Önce ücretsiz denemeyi başlat.")
    try:
        connections.remove(body.token, body.store)
    except Exception:
        log.exception("disconnect failed")
        raise HTTPException(503, "Şu an kaldırılamadı.")
    return {"connected": False}


_cron_lock = threading.Lock()


def _nightly_sync() -> None:
    """Synchronise chaque connexion dont l'essai ou l'abonnement est actif. Une erreur n'arrête pas les autres."""
    if not _cron_lock.acquire(blocking=False):
        return                                   # une synchronisation tourne déjà
    try:
        done = 0
        for c in connections.all_for_sync():
            try:
                t = waitlist.trial_by_token(c["token"])
                if not t or not _trial_state(t)["active"]:
                    connections.record_result(c["token"], c["store"], "abonelik yok", None)
                    continue
                if not c["creds"]:
                    connections.record_result(c["token"], c["store"], "yeniden bağlan", None)
                    continue
                data = trendyol.sync(c["seller_id"], c["creds"]["k"], c["creds"]["s"], 30)
                connections.record_result(c["token"], c["store"], "ok", data)
                done += 1
            except trendyol.TrendyolError as e:
                status = "bilgiler reddedildi" if "reddedildi" in str(e) else "Trendyol hatası"
                connections.record_result(c["token"], c["store"], status, None)
            except Exception as e:
                log.error("nightly sync failed for one store: %s", type(e).__name__)
            time.sleep(1)                        # rester loin des limites de Trendyol
        log.warning("nightly sync done: %s stores updated", done)
    finally:
        _cron_lock.release()


@app.post("/api/cron/sync", status_code=202)
def cron_sync(request: Request):
    secret = request.headers.get("x-cron-secret", "")
    if not CRON_SECRET or not hmac.compare_digest(secret.encode(), CRON_SECRET.encode()):
        raise HTTPException(404, "Not Found")
    if not connections.available():
        raise HTTPException(503, "SYNC_ENC_KEY ou base de données manquant.")
    threading.Thread(target=_nightly_sync, daemon=True).start()   # répond tout de suite, travaille en fond
    return {"started": True}


@app.post("/api/event", status_code=204)
def track_event(body: EventRequest, request: Request):
    # un compteur ne doit jamais casser la page : erreurs silencieuses
    if _under_hourly_limit(_ev_hits, _client_ip(request), EVENTS_PER_IP):
        try:
            metrics.record(body.name, body.source)
        except Exception:
            log.exception("event record failed")
    return Response(status_code=204)


def _pct(a: int, b: int) -> str:
    return f"{a / b * 100:.1f} %" if b else "–"


def _funnel_html(rows: list[dict], days: int = 30) -> str:
    try:
        m = metrics.summary(days)
    except Exception:
        log.exception("metrics summary failed")
        return '<p class="warn">Statistiques indisponibles pour le moment.</p>'
    since = (datetime.now(timezone.utc).date() - timedelta(days=days - 1)).isoformat()
    signups: dict[str, int] = defaultdict(int)
    for r in rows:
        if r["created_at"][:10] >= since:
            signups[r["source"] or "site"] += 1
    t = m["totals"]
    steps = [
        ("Visites de la landing", t["landing_view"], None, ""),
        ("Ouvertures de l'application", t["app_view"], t["landing_view"], ""),
        ("Essais gratuits démarrés", t["trial_started"], t["app_view"], "cible > 5 % des visites"),
        ("Rapports importés (activation)", t["file_loaded"], t["trial_started"], "cible > 60 %"),
        ("Analyses IA demandées", t["ai_requested"], t["file_loaded"], ""),
        ("Rapports Excel téléchargés", t["report_downloaded"], t["file_loaded"], ""),
        ("Contacts (essais + demandes)", sum(signups.values()), t["landing_view"], ""),
    ]
    e = html.escape
    lines = "".join(
        f"<tr><td>{e(label)}</td><td class='n'>{n}</td><td class='n'>{_pct(n, base) if base is not None else ''}</td>"
        f"<td class='muted'>{e(goal)}</td></tr>"
        for label, n, base, goal in steps
    )
    sources = sorted(set(m["by_source"]) | set(signups),
                     key=lambda s: -(m["by_source"].get(s, {}).get("landing_view", 0) + signups.get(s, 0)))
    src_lines = "".join(
        f"<tr><td>{e(s)}</td>"
        + "".join(f"<td class='n'>{m['by_source'].get(s, {}).get(k, 0)}</td>" for k in metrics.EVENTS)
        + f"<td class='n'>{signups.get(s, 0)}</td></tr>"
        for s in sources
    )
    return f"""<h2>Entonnoir · {days} derniers jours</h2>
<div class="tw"><table class="small"><thead><tr><th>Étape</th><th>Nombre</th><th>Conversion</th><th>Objectif du plan</th></tr></thead>
<tbody>{lines}</tbody></table></div>
<h2>Par source (?src=…)</h2>
<div class="tw"><table class="small"><thead><tr><th>Source</th><th>Landing</th><th>App</th><th>Essais</th><th>Imports</th><th>IA</th><th>Rapports</th><th>Contacts</th></tr></thead>
<tbody>{src_lines or '<tr><td colspan="8" class="muted">Pas encore de données.</td></tr>'}</tbody></table></div>
<p class="muted">Compteurs anonymes, une fois par visite et par onglet. Les pourcentages comparent chaque étape à la précédente.</p>
<h2>Demandes</h2>"""


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

    def cell(r: dict, k: str) -> str:
        if k == "plan":
            return PLANS.get(r[k], r[k])
        if k == "trial_at":
            if not r[k]:
                return ""
            left = TRIAL_DAYS - (datetime.now(timezone.utc) - datetime.fromisoformat(r[k])).days
            return f"{left} j restants" if left > 0 else "terminé"
        if k == "paid_until":
            if not r[k]:
                return ""
            until = datetime.fromisoformat(r[k])
            return ("payé jusqu'au " if until > datetime.now(timezone.utc) else "expiré le ") + until.strftime("%d/%m/%Y")
        return str(r[k])

    def extend_btn(r: dict) -> str:
        return (f'<form method="post" action="/admin/extend" style="margin:0">'
                f'<input type="hidden" name="token" value="{e(token)}"><input type="hidden" name="phone" value="{e(r["phone"])}">'
                f'<button title="Le client a payé : +30 jours d\'accès">+30 j</button></form>')

    body_rows = "".join(
        "<tr>" + "".join(f"<td>{e(cell(r, k))}</td>" for k in waitlist.FIELDS)
        + f'<td><a href="https://wa.me/{_wa_number(r["phone"])}">WhatsApp</a></td><td>{extend_btn(r)}</td></tr>'
        for r in rows
    )
    try:
        tickets = waitlist.recent_tickets()
    except Exception:
        log.exception("tickets failed")
        tickets = []
    ticket_rows = "".join(
        f"<tr><td>#{t['id']}</td><td>{e(t['created_at'][:16].replace('T', ' '))}</td>"
        f"<td>{e(t['name'] or '–')}<br><span class='muted'>{e(t['store'])}</span></td>"
        f"<td class='wrapc'>{e(t['question'])}</td><td class='wrapc muted'>{e(t['ai_answer'][:300])}</td>"
        + (f'<td><a href="https://wa.me/{_wa_number(t["phone"])}">WhatsApp</a></td>' if t["phone"] else "<td></td>")
        + "</tr>"
        for t in tickets
    )
    trials = sum(1 for r in rows if r["trial_at"])
    try:
        conns = connections.overview() if connections.available() else []
    except Exception:
        log.exception("connections overview failed")
        conns = []
    conn_rows = "".join(
        f"<tr><td>{e(c['name'] or '–')}</td><td>{e(c['store'])}</td><td>{e(c['seller_id'])}</td>"
        f"<td>{e(c['last_sync_at'])}</td><td class='{'' if c['last_status'] == 'ok' else 'warn'}'>{e(c['last_status'] or '–')}</td></tr>"
        for c in conns
    )
    storage = waitlist.storage_kind()
    warn = "" if storage == "postgres" else (
        '<p class="warn">⚠ Base de données non connectée (DATABASE_URL manquant) : '
        "les inscriptions seront perdues au prochain redéploiement.</p>"
    )
    return f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Demandes ProfitPilot</title>
<style>
:root{{--bg:#E8ECF1;--ink:#16223A;--muted:#56637A;--paper:#fff;--line:#C7D0DB;--green:#0E7A5A;--red:#C8102E}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0F1726;--ink:#E7ECF3;--muted:#9AA6BA;--paper:#18233A;--line:#2D3B56;--green:#3DCB98;--red:#FF5B6F}}}}
body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}}
.wrap{{max-width:1100px;margin:0 auto;padding:20px 16px}}
h1{{margin:0 0 4px;font-size:26px}} .big{{font-size:40px;font-weight:800;color:var(--green)}}
.muted{{color:var(--muted)}} .warn{{color:var(--red);font-weight:600}}
a{{color:var(--green)}} .tw{{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--paper);margin-top:14px}}
table{{border-collapse:collapse;width:100%;min-width:760px}} table.small{{min-width:0}} td.n{{text-align:right;font-variant-numeric:tabular-nums}} h2{{font-size:18px;margin:22px 0 0}} th,td{{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}}
th{{font-size:12px;color:var(--muted)}} td.wrapc{{white-space:normal;min-width:220px}}
</style></head><body><div class="wrap">
<h1>Demandes ProfitPilot</h1>
<div class="big">{len(rows)} <span class="muted" style="font-size:16px;font-weight:400">contacts · dont {trials} essais gratuits · {len(tickets)} tickets d'aide</span></div>
{warn}
{_funnel_html(rows)}
<p><a href="/admin/waitlist.csv?token={e(token)}">Télécharger en CSV (Excel)</a></p>
<div class="tw"><table><thead><tr><th>Date (UTC)</th><th>Nom</th><th>Boutique</th><th>Téléphone</th><th>Commandes/mois</th><th>Offre</th><th>Essai</th><th>Abonnement</th><th>Source</th><th></th><th>Paiement reçu</th></tr></thead>
<tbody>{body_rows or '<tr><td colspan="11" class="muted">Aucune demande pour le moment.</td></tr>'}</tbody></table></div>
<h2>Connexions Trendyol (synchronisation de nuit)</h2>
<div class="tw"><table><thead><tr><th>Client</th><th>Magasin</th><th>ID vendeur</th><th>Dernière synchro</th><th>État</th></tr></thead>
<tbody>{conn_rows or '<tr><td colspan="5" class="muted">Aucune connexion enregistrée.</td></tr>'}</tbody></table></div>
<h2>Tickets d'aide (non résolus par l'assistant)</h2>
<div class="tw"><table><thead><tr><th>N°</th><th>Date (UTC)</th><th>Client</th><th>Problème</th><th>Réponse de l'assistant</th><th></th></tr></thead>
<tbody>{ticket_rows or '<tr><td colspan="6" class="muted">Aucun ticket.</td></tr>'}</tbody></table></div>
</div></body></html>"""


@app.post("/admin/extend")
async def admin_extend(request: Request):
    form = await request.form()
    token, phone = str(form.get("token", "")), str(form.get("phone", ""))
    _require_admin(token)
    try:
        waitlist.extend_access(phone, 30)
    except Exception:
        log.exception("extend failed")
        raise HTTPException(503, "Base de données indisponible.")
    return RedirectResponse(f"/admin?token={token}", status_code=303)


@app.get("/")
def index():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/app.html")
def app_page():
    return FileResponse(BASE_DIR / "app.html")


@app.get("/static/xlsx.full.min.js")
def xlsx_lib():
    # Lecteur Excel (SheetJS CE, Apache-2.0) servi par le site : pas de dépendance à un CDN
    return FileResponse(
        BASE_DIR / "static" / "xlsx.full.min.js",
        media_type="application/javascript",
        headers={"Cache-Control": "public, max-age=604800"},
    )


@app.get("/index.html")
def index_html():
    return FileResponse(BASE_DIR / "index.html")
