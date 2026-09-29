"""Contacts (demandes, essais gratuits) et tickets d'aide : Postgres (DATABASE_URL)
ou, à défaut, fichiers locaux JSONL.

Le fichier local ne sert qu'en développement : sur Render (plan free), le disque est
effacé à chaque redéploiement, donc DATABASE_URL doit être configuré en production.
"""

import csv
import io
import json
import os
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path

FIELDS = ["created_at", "name", "store", "phone", "monthly_sales", "plan", "trial_at", "paid_until", "source"]
TICKET_FIELDS = ["id", "created_at", "name", "store", "phone", "question", "ai_answer"]
_LOCAL_FILE = Path(__file__).resolve().parent / "waitlist.jsonl"
_LOCAL_TICKETS = Path(__file__).resolve().parent / "tickets.jsonl"
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


_schema_lock = threading.Lock()  # deux requêtes simultanées ne doivent pas créer la table en même temps


def _ensure_table(conn) -> None:
    global _table_ready
    if _table_ready:
        return
    with _schema_lock:
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
        conn.execute("ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS token TEXT NOT NULL DEFAULT ''")
        conn.execute("ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS trial_at TIMESTAMPTZ")
        conn.execute("ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS paid_until TIMESTAMPTZ")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS tickets (
                id SERIAL PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                token TEXT NOT NULL DEFAULT '',
                question TEXT NOT NULL,
                ai_answer TEXT NOT NULL DEFAULT ''
            )"""
        )
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
    return [{**{k: "" for k in FIELDS}, "token": "", **r} for r in rows]


def _write_local(rows: list[dict]) -> None:
    _LOCAL_FILE.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------- #
# Essai gratuit
# --------------------------------------------------------------------------- #
def start_trial(name: str, store: str, phone: str, source: str, plan: str = "deneme") -> tuple[str, str]:
    """Démarre l'essai de ce numéro et renvoie (jeton, date de début ISO).
    Un numéro qui a déjà un essai récupère le même : l'essai ne se relance pas."""
    if _db_url():
        with _connect() as conn:
            _ensure_table(conn)
            row = conn.execute(
                "SELECT token, trial_at FROM waitlist WHERE phone = %s ORDER BY id LIMIT 1", (phone,)
            ).fetchone()
            if row and row[0] and row[1]:
                return row[0], row[1].isoformat(timespec="seconds")
            token = secrets.token_urlsafe(24)
            if row:
                cur = conn.execute(
                    """UPDATE waitlist SET token = %s, trial_at = now(),
                       plan = CASE WHEN plan = '' THEN %s ELSE plan END
                       WHERE phone = %s RETURNING trial_at""", (token, plan, phone))
            else:
                cur = conn.execute(
                    """INSERT INTO waitlist (name, store, phone, plan, source, token, trial_at)
                       VALUES (%s, %s, %s, %s, %s, %s, now()) RETURNING trial_at""",
                    (name, store, phone, plan, source, token))
            started = cur.fetchone()[0]
            conn.commit()
            return token, started.isoformat(timespec="seconds")
    with _lock:
        rows = _read_local()
        for r in rows:
            if r["phone"] == phone:
                if r.get("token") and r.get("trial_at"):
                    return r["token"], r["trial_at"]
                r.update(token=secrets.token_urlsafe(24), trial_at=_now_iso(), plan=r["plan"] or plan)
                _write_local(rows)
                return r["token"], r["trial_at"]
        r = {"created_at": _now_iso(), "name": name, "store": store, "phone": phone, "monthly_sales": "",
             "plan": plan, "source": source, "token": secrets.token_urlsafe(24), "trial_at": _now_iso()}
        rows.append(r)
        _write_local(rows)
        return r["token"], r["trial_at"]


def trial_by_token(token: str) -> dict | None:
    if not token:
        return None
    if _db_url():
        with _connect() as conn:
            _ensure_table(conn)
            row = conn.execute(
                "SELECT name, store, phone, trial_at, plan, paid_until FROM waitlist WHERE token = %s LIMIT 1",
                (token,),
            ).fetchone()
            if not row or not row[3]:
                return None
            return {"name": row[0], "store": row[1], "phone": row[2], "trial_at": row[3], "plan": row[4],
                    "paid_until": row[5]}
    with _lock:
        for r in _read_local():
            if r.get("token") == token and r.get("trial_at"):
                return {"name": r["name"], "store": r["store"], "phone": r["phone"],
                        "trial_at": datetime.fromisoformat(r["trial_at"]), "plan": r["plan"],
                        "paid_until": datetime.fromisoformat(r["paid_until"]) if r.get("paid_until") else None}
    return None


def extend_access(phone: str, days: int) -> bool:
    """Prolonge l'accès payé de `days` jours (à partir d'aujourd'hui ou de la fin actuelle)."""
    if _db_url():
        with _connect() as conn:
            _ensure_table(conn)
            cur = conn.execute(
                """UPDATE waitlist SET paid_until = GREATEST(COALESCE(paid_until, now()), now())
                   + make_interval(days => %s) WHERE phone = %s""", (days, phone))
            conn.commit()
            return cur.rowcount > 0
    from datetime import timedelta
    with _lock:
        rows = _read_local()
        hit = False
        for r in rows:
            if r["phone"] == phone:
                base = max(datetime.fromisoformat(r["paid_until"]) if r.get("paid_until") else datetime.now(timezone.utc),
                           datetime.now(timezone.utc))
                r["paid_until"] = (base + timedelta(days=days)).isoformat(timespec="seconds")
                hit = True
        _write_local(rows)
        return hit


# --------------------------------------------------------------------------- #
# Tickets d'aide (problèmes que l'assistant n'a pas résolus)
# --------------------------------------------------------------------------- #
def add_ticket(token: str, question: str, ai_answer: str) -> int:
    if _db_url():
        with _connect() as conn:
            _ensure_table(conn)
            tid = conn.execute(
                "INSERT INTO tickets (token, question, ai_answer) VALUES (%s, %s, %s) RETURNING id",
                (token, question, ai_answer),
            ).fetchone()[0]
            conn.commit()
            return tid
    with _lock:
        existing = _LOCAL_TICKETS.read_text(encoding="utf-8").splitlines() if _LOCAL_TICKETS.exists() else []
        tid = len(existing) + 1
        with _LOCAL_TICKETS.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"id": tid, "created_at": _now_iso(), "token": token,
                                "question": question, "ai_answer": ai_answer}, ensure_ascii=False) + "\n")
        return tid


def recent_tickets(limit: int = 50) -> list[dict]:
    """Derniers tickets avec le nom, la boutique et le téléphone du client."""
    if _db_url():
        with _connect() as conn:
            _ensure_table(conn)
            cur = conn.execute(
                """SELECT t.id, t.created_at, COALESCE(w.name, ''), COALESCE(w.store, ''), COALESCE(w.phone, ''),
                          t.question, t.ai_answer
                   FROM tickets t LEFT JOIN waitlist w ON w.token = t.token AND t.token <> ''
                   ORDER BY t.id DESC LIMIT %s""", (limit,))
            return [dict(zip(TICKET_FIELDS, (r[0], r[1].isoformat(timespec="seconds"), *r[2:])))
                    for r in cur.fetchall()]
    with _lock:
        people = {r["token"]: r for r in _read_local() if r.get("token")}
        lines = _LOCAL_TICKETS.read_text(encoding="utf-8").splitlines() if _LOCAL_TICKETS.exists() else []
        out = []
        for line in reversed(lines[-limit:]):
            t = json.loads(line)
            p = people.get(t["token"], {})
            out.append({"id": t["id"], "created_at": t["created_at"], "name": p.get("name", ""),
                        "store": p.get("store", ""), "phone": p.get("phone", ""),
                        "question": t["question"], "ai_answer": t["ai_answer"]})
        return out


def all_rows() -> list[dict]:
    """Tous les inscrits, du plus récent au plus ancien."""
    if _db_url():
        with _connect() as conn:
            _ensure_table(conn)
            cur = conn.execute(
                """SELECT created_at, name, store, phone, monthly_sales, plan, trial_at, paid_until, source
                   FROM waitlist ORDER BY id DESC"""
            )
            iso = lambda d: d.isoformat(timespec="seconds") if d else ""
            return [
                dict(zip(FIELDS, (iso(r[0]), *r[1:6], iso(r[6]), iso(r[7]), r[8])))
                for r in cur.fetchall()
            ]
    with _lock:
        return [{k: r.get(k, "") for k in FIELDS} for r in reversed(_read_local())]


def to_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    buf.write("﻿")  # BOM : Excel ouvre correctement les caractères turcs
    w = csv.DictWriter(buf, fieldnames=FIELDS, delimiter=";")
    w.writeheader()
    # une cellule qui commence par = + - @ serait exécutée comme formule par Excel
    w.writerows({k: ("'" + v if isinstance(v, str) and v and v[0] in "=+-@" else v) for k, v in r.items()} for r in rows)
    return buf.getvalue()
