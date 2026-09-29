"""Connexions Trendyol enregistrées pour la synchronisation de nuit.

Les identifiants sont chiffrés (Fernet) avec SYNC_ENC_KEY, une clé qui n'existe que dans l'environnement
Render : une copie de la base seule ne permet pas de les lire. Seule la dernière synchronisation de chaque
magasin est conservée (tableau prêt à afficher). Nécessite Postgres (DATABASE_URL).
"""

import json
import os
import threading
from datetime import datetime, timezone

import waitlist

_table_ready = False
_schema_lock = threading.Lock()


class NotConfigured(Exception):
    pass


def _fernet():
    key = os.getenv("SYNC_ENC_KEY", "")
    if not key or waitlist.storage_kind() != "postgres":
        raise NotConfigured()
    from cryptography.fernet import Fernet

    return Fernet(key.encode())


def available() -> bool:
    try:
        _fernet()
        return True
    except NotConfigured:
        return False


def _ensure_table(conn) -> None:
    global _table_ready
    if _table_ready:
        return
    with _schema_lock:
        if _table_ready:
            return
        conn.execute(
            """CREATE TABLE IF NOT EXISTS connections (
                token TEXT NOT NULL,
                store TEXT NOT NULL,
                seller_id TEXT NOT NULL,
                creds BYTEA NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                last_sync_at TIMESTAMPTZ,
                last_status TEXT NOT NULL DEFAULT '',
                snapshot TEXT,
                PRIMARY KEY (token, store)
            )"""
        )
        conn.commit()
        _table_ready = True


def save(token: str, store: str, seller_id: str, api_key: str, api_secret: str, snapshot: dict) -> None:
    creds = _fernet().encrypt(json.dumps({"k": api_key, "s": api_secret}).encode())
    with waitlist._connect() as conn:
        _ensure_table(conn)
        conn.execute(
            """INSERT INTO connections (token, store, seller_id, creds, last_sync_at, last_status, snapshot)
               VALUES (%s, %s, %s, %s, now(), 'ok', %s)
               ON CONFLICT (token, store) DO UPDATE SET seller_id = EXCLUDED.seller_id, creds = EXCLUDED.creds,
                 last_sync_at = now(), last_status = 'ok', snapshot = EXCLUDED.snapshot""",
            (token, store, seller_id, creds, json.dumps(snapshot, ensure_ascii=False)),
        )
        conn.commit()


def remove(token: str, store: str) -> bool:
    with waitlist._connect() as conn:
        _ensure_table(conn)
        cur = conn.execute("DELETE FROM connections WHERE token = %s AND store = %s", (token, store))
        conn.commit()
        return cur.rowcount > 0


def get_snapshot(token: str, store: str) -> dict | None:
    with waitlist._connect() as conn:
        _ensure_table(conn)
        row = conn.execute(
            "SELECT seller_id, last_sync_at, last_status, snapshot FROM connections WHERE token = %s AND store = %s",
            (token, store),
        ).fetchone()
    if not row:
        return None
    return {
        "seller_id": row[0],
        "last_sync_at": row[1].isoformat(timespec="seconds") if row[1] else "",
        "last_status": row[2],
        "snapshot": json.loads(row[3]) if row[3] else None,
    }


def all_for_sync() -> list[dict]:
    """Toutes les connexions avec leurs identifiants déchiffrés (usage : synchronisation de nuit)."""
    f = _fernet()
    with waitlist._connect() as conn:
        _ensure_table(conn)
        rows = conn.execute("SELECT token, store, seller_id, creds FROM connections").fetchall()
    out = []
    for token, store, seller_id, creds in rows:
        try:
            c = json.loads(f.decrypt(bytes(creds)))
        except Exception:
            c = None   # clé de chiffrement changée : le vendeur devra se reconnecter
        out.append({"token": token, "store": store, "seller_id": seller_id, "creds": c})
    return out


def get_creds(token: str, store: str) -> dict | None:
    f = _fernet()
    with waitlist._connect() as conn:
        _ensure_table(conn)
        row = conn.execute(
            "SELECT seller_id, creds FROM connections WHERE token = %s AND store = %s", (token, store)
        ).fetchone()
    if not row:
        return None
    try:
        c = json.loads(f.decrypt(bytes(row[1])))
    except Exception:
        return {"seller_id": row[0], "creds": None}
    return {"seller_id": row[0], "creds": c}


def record_result(token: str, store: str, status: str, snapshot: dict | None) -> None:
    with waitlist._connect() as conn:
        _ensure_table(conn)
        if snapshot is not None:
            conn.execute(
                """UPDATE connections SET last_sync_at = now(), last_status = %s, snapshot = %s
                   WHERE token = %s AND store = %s""",
                (status, json.dumps(snapshot, ensure_ascii=False), token, store),
            )
        else:
            conn.execute(
                "UPDATE connections SET last_status = %s WHERE token = %s AND store = %s",
                (status, token, store),
            )
        conn.commit()


def overview() -> list[dict]:
    """Pour l'admin : connexions sans identifiants."""
    with waitlist._connect() as conn:
        _ensure_table(conn)
        rows = conn.execute(
            """SELECT c.store, c.seller_id, c.last_sync_at, c.last_status, COALESCE(w.name, ''), COALESCE(w.phone, '')
               FROM connections c LEFT JOIN waitlist w ON w.token = c.token ORDER BY c.last_sync_at DESC NULLS LAST"""
        ).fetchall()
    return [
        {"store": r[0], "seller_id": r[1],
         "last_sync_at": r[2].astimezone(timezone.utc).strftime("%d/%m %H:%M UTC") if r[2] else "–",
         "last_status": r[3], "name": r[4], "phone": r[5]}
        for r in rows
    ]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
