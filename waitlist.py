"""Liste d'attente : stockage Postgres (DATABASE_URL) ou, à défaut, fichier local JSONL.

Le fichier local ne sert qu'en développement : sur Render (plan free), le disque est
effacé à chaque redéploiement, donc DATABASE_URL doit être configuré en production.
"""

import csv
import io
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

FIELDS = ["created_at", "name", "store", "phone", "monthly_sales", "plan", "source"]
_LOCAL_FILE = Path(__file__).resolve().parent / "waitlist.jsonl"
_lock = threading.Lock()
_table_ready = False


def _db_url() -> str:
    return os.getenv("DATABASE_URL", "")


def storage_kind() -> str:
    return "postgres" if _db_url() else "local_file"


def db_host() -> str:
    """Nom du serveur de DATABASE_URL, sans identifiants (diagnostic)."""
    from urllib.parse import urlsplit

    url = _db_url()
    if not url:
        return ""
    try:
        return urlsplit(url).hostname or "(absent)"
    except ValueError:
        return "(adresse invalide)"


def _connect():
    import psycopg  # importé à la demande : inutile sans base de données

    return psycopg.connect(_db_url(), connect_timeout=10)


def _ensure_table(conn) -> None:
    global _table_ready
    if _table_ready:
        return
    conn.execute(
        """CREATE TABLE IF NOT EXISTS waitlist (
            id SERIAL PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            name TEXT NOT NULL,
            store TEXT NOT NULL,
            phone TEXT NOT NULL,
            monthly_sales TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT ''
        )"""
    )
    conn.execute("ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT ''")
    conn.commit()
    _table_ready = True


def add(name: str, store: str, phone: str, monthly_sales: str, source: str, plan: str = "") -> bool:
    """Ajoute un inscrit. Retourne False si ce numéro est déjà inscrit
    (son plan est alors mis à jour s'il en choisit un)."""
    if _db_url():
        with _connect() as conn:
            _ensure_table(conn)
            exists = conn.execute("SELECT 1 FROM waitlist WHERE phone = %s LIMIT 1", (phone,)).fetchone()
            if exists:
                if plan:
                    conn.execute("UPDATE waitlist SET plan = %s WHERE phone = %s", (plan, phone))
                    conn.commit()
                return False
            conn.execute(
                "INSERT INTO waitlist (name, store, phone, monthly_sales, plan, source) VALUES (%s, %s, %s, %s, %s, %s)",
                (name, store, phone, monthly_sales, plan, source),
            )
            conn.commit()
            return True
    with _lock:
        if any(r["phone"] == phone for r in _read_local()):
            return False
        row = {
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "name": name, "store": store, "phone": phone,
            "monthly_sales": monthly_sales, "plan": plan, "source": source,
        }
        with _LOCAL_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        return True


def _read_local() -> list[dict]:
    if not _LOCAL_FILE.exists():
        return []
    rows = [json.loads(line) for line in _LOCAL_FILE.read_text(encoding="utf-8").splitlines() if line.strip()]
    return [{**{k: "" for k in FIELDS}, **r} for r in rows]


def all_rows() -> list[dict]:
    """Tous les inscrits, du plus récent au plus ancien."""
    if _db_url():
        with _connect() as conn:
            _ensure_table(conn)
            cur = conn.execute(
                "SELECT created_at, name, store, phone, monthly_sales, plan, source FROM waitlist ORDER BY id DESC"
            )
            return [
                dict(zip(FIELDS, (r[0].isoformat(timespec="seconds"), *r[1:])))
                for r in cur.fetchall()
            ]
    with _lock:
        return list(reversed(_read_local()))


def to_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    buf.write("﻿")  # BOM : Excel ouvre correctement les caractères turcs
    w = csv.DictWriter(buf, fieldnames=FIELDS, delimiter=";")
    w.writeheader()
    # une cellule qui commence par = + - @ serait exécutée comme formule par Excel
    w.writerows({k: ("'" + v if isinstance(v, str) and v and v[0] in "=+-@" else v) for k, v in r.items()} for r in rows)
    return buf.getvalue()
