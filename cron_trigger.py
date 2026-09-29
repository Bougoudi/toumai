"""Tâche de nuit (Render Cron Job) : réveille le site et lance la synchronisation Trendyol.

Variables : PROFITPILOT_URL (ex. https://profitpilot-t78l.onrender.com) et CRON_SECRET.
Le site gratuit peut dormir : le premier appel le réveille (jusqu'à ~1 min), d'où les tentatives.
"""

import os
import sys
import time
import urllib.error
import urllib.request

url = os.environ["PROFITPILOT_URL"].rstrip("/") + "/api/cron/sync"
secret = os.environ["CRON_SECRET"]

for attempt in range(1, 6):
    try:
        req = urllib.request.Request(url, method="POST", headers={"X-Cron-Secret": secret})
        with urllib.request.urlopen(req, timeout=120) as r:
            print(f"synchronisation lancée (HTTP {r.status})")
            sys.exit(0)
    except urllib.error.HTTPError as e:
        print(f"tentative {attempt} : HTTP {e.code}")
        if e.code in (401, 403, 404):
            sys.exit(1)                      # secret incorrect : inutile d'insister
    except Exception as e:                   # site encore endormi, réseau…
        print(f"tentative {attempt} : {type(e).__name__}")
    time.sleep(30)
sys.exit(1)
