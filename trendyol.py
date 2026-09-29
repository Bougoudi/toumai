"""Connexion à l'API vendeur Trendyol (lecture seule).

- Commandes : GET /integration/order/sellers/{id}/orders (fenêtres de 14 jours max, 200 par page, 1 mois d'historique)
- Commissions réelles : GET /integration/finance/che/sellers/{id}/settlements (Sale, fenêtres de 15 jours max)

Les identifiants du vendeur ne sont ni stockés ni journalisés : ils servent le temps de la requête.
Le résultat est un tableau au format des rapports Excel (en-têtes turcs) que l'application lit comme un fichier.
"""

import base64
import time
from collections import defaultdict

import httpx

BASE = "https://apigw.trendyol.com/integration"
DAY_MS = 86_400_000
MAX_PAGES = 60  # 60 × 200 = 12 000 colis par fenêtre, largement au-dessus des 10 000 permis par Trendyol

HEADERS = ["Sipariş Numarası", "Ürün Adı", "Barkod", "Adet", "Faturalanacak Tutar", "Komisyon Tutarı", "Sipariş Durumu"]

# statut de ligne Trendyol → libellé compris par l'application (iptal = exclu, iade = retour)
STATUS_TR = {
    "Cancelled": "İptal", "UnSupplied": "İptal", "Returned": "İade",
    "Delivered": "Teslim Edildi", "Shipped": "Kargoda", "AtCollectionPoint": "Kargoda",
    "Created": "Hazırlanıyor", "Picking": "Hazırlanıyor", "Invoiced": "Hazırlanıyor", "Awaiting": "Hazırlanıyor",
    "UnDelivered": "Teslim Edilemedi",
}


class TrendyolError(Exception):
    """Erreur à montrer au vendeur (message en turc)."""


def _client(seller_id: str, api_key: str, api_secret: str) -> httpx.Client:
    auth = base64.b64encode(f"{api_key}:{api_secret}".encode()).decode()
    return httpx.Client(
        timeout=httpx.Timeout(30.0, connect=10.0),
        headers={
            "Authorization": f"Basic {auth}",
            "User-Agent": f"{seller_id} - SelfIntegration",   # exigé par Trendyol, sinon 403
            "Accept": "application/json",
        },
    )


def _get(client: httpx.Client, url: str, params: dict) -> dict:
    for attempt in range(3):
        try:
            r = client.get(url, params=params)
        except httpx.HTTPError:
            if attempt == 2:
                raise TrendyolError("Trendyol'a bağlanılamadı. Biraz sonra tekrar dene.")
            time.sleep(1.5 * (attempt + 1))
            continue
        if r.status_code == 400 and "storefront" in r.text.lower() and "storeFrontCode" not in client.headers:
            client.headers["storeFrontCode"] = "TR"   # certaines versions de l'API l'exigent
            continue
        if r.status_code in (401, 403):
            raise TrendyolError("Trendyol bilgileri reddedildi. Satıcı ID, API Key ve API Secret'ı kontrol et.")
        if r.status_code == 429 or r.status_code >= 500:
            if attempt == 2:
                raise TrendyolError(f"Trendyol şu an yanıt vermiyor ({r.status_code}). Biraz sonra tekrar dene.")
            time.sleep(2 * (attempt + 1))
            continue
        if r.status_code != 200:
            raise TrendyolError(f"Trendyol hata verdi ({r.status_code}).")
        return r.json()
    raise TrendyolError("Trendyol'dan veri alınamadı.")


def _windows(start_ms: int, end_ms: int, span_days: int):
    t = start_ms
    while t < end_ms:
        yield t, min(t + span_days * DAY_MS - 1, end_ms)
        t += span_days * DAY_MS


def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _line_revenue(line: dict) -> float:
    """Montant encaissé pour la ligne, TVA incluse, après la remise du vendeur.
    (La remise financée par Trendyol lui est remboursée : elle ne réduit pas son chiffre.)"""
    qty = _num(line.get("quantity")) or 1
    if line.get("lineGrossAmount") is not None:                       # API v3
        gross = _num(line.get("lineGrossAmount"))
        seller_disc = _num(line.get("lineSellerDiscount"))
        return gross - seller_disc
    price, amount, disc = _num(line.get("price")), _num(line.get("amount")), _num(line.get("discount"))
    gross = amount if amount >= price * qty - 0.01 else price * qty   # amount = total de ligne, sinon prix × qté
    return gross - disc


def fetch_orders(client: httpx.Client, seller_id: str, start_ms: int, end_ms: int) -> list[dict]:
    lines = []
    for w_start, w_end in _windows(start_ms, end_ms, 14):
        page = 0
        while page < MAX_PAGES:
            data = _get(client, f"{BASE}/order/sellers/{seller_id}/orders", {
                "startDate": w_start, "endDate": w_end, "page": page, "size": 200,
                "orderByField": "CreatedDate", "orderByDirection": "ASC",
            })
            for pkg in data.get("content") or []:
                order_no = str(pkg.get("orderNumber") or pkg.get("id") or "")
                pkg_status = pkg.get("status") or pkg.get("shipmentPackageStatus") or ""
                for line in pkg.get("lines") or []:
                    status = line.get("orderLineItemStatusName") or pkg_status
                    lines.append({
                        "order": order_no,
                        "name": (line.get("productName") or line.get("merchantSku") or line.get("barcode") or "?").strip(),
                        "barcode": str(line.get("barcode") or ""),
                        "qty": _num(line.get("quantity")) or 1,
                        "revenue": round(_line_revenue(line), 2),
                        "status": STATUS_TR.get(status, status),
                    })
            page += 1
            if page >= int(data.get("totalPages") or 0):
                break
    return lines


def fetch_commissions(client: httpx.Client, seller_id: str, start_ms: int, end_ms: int) -> dict[tuple[str, str], float]:
    """Commission réelle par (n° de commande, code-barres), depuis le relevé de compte (ventes)."""
    out: dict[tuple[str, str], float] = defaultdict(float)
    for w_start, w_end in _windows(start_ms, end_ms, 15):
        page = 0
        while page < MAX_PAGES:
            data = _get(client, f"{BASE}/finance/che/sellers/{seller_id}/settlements", {
                "startDate": w_start, "endDate": w_end, "transactionType": "Sale", "page": page, "size": 1000,
            })
            for item in data.get("content") or []:
                amount = abs(_num(item.get("commissionAmount")))
                if amount:
                    out[(str(item.get("orderNumber") or ""), str(item.get("barcode") or ""))] += amount
            page += 1
            if page >= int(data.get("totalPages") or 0):
                break
    return out


def sync(seller_id: str, api_key: str, api_secret: str, days: int = 30) -> dict:
    """Commandes des `days` derniers jours au format tableau, avec commissions réelles quand Trendyol les a."""
    seller_id = seller_id.strip()
    if not seller_id.isdigit():
        raise TrendyolError("Satıcı ID sadece rakamlardan oluşur.")
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - min(max(days, 1), 30) * DAY_MS
    with _client(seller_id, api_key.strip(), api_secret.strip()) as client:
        lines = fetch_orders(client, seller_id, start_ms, end_ms)
        commission_note = "ok"
        try:
            # le relevé est aussi consulté un mois en arrière : une vente livrée tard peut y figurer plus tard
            commissions = fetch_commissions(client, seller_id, start_ms, end_ms)
        except TrendyolError:
            commissions, commission_note = {}, "unavailable"

    used: set[tuple[str, str]] = set()
    rows = []
    for l in lines:
        key = (l["order"], l["barcode"])
        comm = ""
        if key in commissions and key not in used and l["status"] not in ("İptal", "İade"):
            comm = round(commissions[key], 2)
            used.add(key)            # plusieurs lignes du même article : la commission n'est comptée qu'une fois
        rows.append([l["order"], l["name"], l["barcode"], l["qty"], l["revenue"], comm, l["status"]])
    return {
        "headers": HEADERS,
        "rows": rows,
        "orders": len({l["order"] for l in lines}),
        "lines_with_commission": len(used),
        "commission_source": commission_note,
        "days": min(max(days, 1), 30),
    }
