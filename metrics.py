"""Compteurs de l'entonnoir (visites → essai → activation), agrégés par jour et par source.

Aucune donnée personnelle : ni IP, ni cookie, seulement des totaux quotidiens.
Stockage Postgres si DATABASE_URL est défini, sinon en mémoire (développement).
"""

import threading
from collections import defaultdict
from datetime import date, timedelta

import waitlist

# ordre = étapes de l'entonnoir
EVENTS = {
    "landing_view": "Visites de la landing",
    "app_view": "Visites de l'application",
    "trial_started": "Essais gratuits démarrés",
    "file_loaded": "Rapports importés (activation)",
    "ai_requested": "Analyses IA demandées",
    "report_downloaded": "Rapports Excel téléchargés",
}

_lock = threading.Lock()
_memory: dict[tuple[str, str, str], int] = defaultdict(int)
_table_ready = False
_schema_lock = threading.Lock()  # deux requêtes simultanées ne doivent pas créer la table en même temps


def _ensure_table(conn) -> None:
    global _table_ready
    if _table_ready:
        return
    with _schema_lock:
        if _table_ready:
            return
        conn.execute(
            """CREATE TABLE IF NOT EXISTS events (
                day DATE NOT NULL,
                name TEXT NOT NULL,
                source TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (day, name, source)
            )"""
        )
        conn.commit()
        _table_ready = True


def record(name: str, source: str) -> None:
    if name not in EVENTS:
        return
    source = (source or "site")[:50]
    if waitlist.storage_kind() == "postgres":
        with waitlist._connect() as conn:
            _ensure_table(conn)
            conn.execute(
                """INSERT INTO events (day, name, source, count) VALUES (CURRENT_DATE, %s, %s, 1)
                   ON CONFLICT (day, name, source) DO UPDATE SET count = events.count + 1""",
                (name, source),
            )
            conn.commit()
        return
    with _lock:
        _memory[(date.today().isoformat(), name, source)] += 1


def summary(days: int = 30) -> dict:
    """Totaux par événement et par source sur les `days` derniers jours."""
    since = date.today() - timedelta(days=days - 1)
    rows: list[tuple[str, str, int]] = []
    if waitlist.storage_kind() == "postgres":
        with waitlist._connect() as conn:
            _ensure_table(conn)
            rows = conn.execute(
                "SELECT name, source, SUM(count) FROM events WHERE day >= %s GROUP BY name, source",
                (since,),
            ).fetchall()
    else:
        with _lock:
            agg: dict[tuple[str, str], int] = defaultdict(int)
            for (day, name, source), n in _memory.items():
                if day >= since.isoformat():
                    agg[(name, source)] += n
            rows = [(n, s, c) for (n, s), c in agg.items()]
    totals = {k: 0 for k in EVENTS}
    by_source: dict[str, dict[str, int]] = defaultdict(lambda: {k: 0 for k in EVENTS})
    for name, source, n in rows:
        if name in totals:
            totals[name] += int(n)
            by_source[source][name] += int(n)
    return {"totals": totals, "by_source": dict(by_source)}
