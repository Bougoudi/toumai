#!/bin/sh
# Test de bout en bout : Postgres local + faux Trendyol + fausse API Anthropic + navigateur (Playwright).
# Usage (depuis la racine du projet, avec .venv contenant requirements + playwright + openpyxl) : sh tests/run.sh
set -e
PGB=${PGB:-/usr/lib/postgresql/16/bin}
W=/tmp/pp_e2e; rm -rf $W; mkdir -p $W; chown nobody $W
su nobody -s /bin/sh -c "$PGB/initdb -D $W/pg/data -U pp -A trust >/dev/null && $PGB/pg_ctl -D $W/pg/data -o '-p 5499 -k $W/pg' -l $W/pg.log start >/dev/null"
sleep 2
.venv/bin/python tests/fake_anthropic.py > $W/anth.log 2>&1 & A=$!
export DATABASE_URL="postgresql://pp@127.0.0.1:5499/postgres" ADMIN_TOKEN=x CRON_SECRET=cronsecret \
       ANTHROPIC_API_KEY=sk-ant-test ANTHROPIC_BASE_URL=http://127.0.0.1:8799 NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost
export SYNC_ENC_KEY=$(.venv/bin/python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())")
.venv/bin/python tests/run_app.py > $W/srv.log 2>&1 & S=$!
sleep 5
.venv/bin/python tests/e2e.py || true
kill $A $S 2>/dev/null
su nobody -s /bin/sh -c "$PGB/pg_ctl -D $W/pg/data stop >/dev/null"
