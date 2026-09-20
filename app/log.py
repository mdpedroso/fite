#!/usr/bin/env python3
"""Append de evento no log. Uso:

    echo '<json>' | python3 app/log.py

Gera id e logged_at, valida o mínimo, escreve em data/<who>/<YYYY-MM>.jsonl.
Existe pra garantir que nenhuma linha malformada entre no histórico.
"""
import json, sys, random, string
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TYPES = {"meal", "workout", "weight", "note"}


def main() -> int:
    tz = ZoneInfo(json.loads((DATA / "profiles.json").read_text())["timezone"])
    now = datetime.now(tz)

    payload = json.load(sys.stdin)
    events = payload if isinstance(payload, list) else [payload]

    written = []
    for ev in events:
        for field in ("who", "type", "raw"):
            if not ev.get(field):
                sys.exit(f"erro: campo obrigatório ausente: {field}")
        if ev["type"] not in TYPES:
            sys.exit(f"erro: type inválido: {ev['type']} (use {sorted(TYPES)})")

        ev.setdefault("ts", now.isoformat(timespec="seconds"))
        ts = datetime.fromisoformat(ev["ts"])
        suffix = "".join(random.choices(string.hexdigits[:16].lower(), k=4))
        ev.setdefault("id", f"{ts:%Y%m%dT%H%M}-{suffix}")
        ev["logged_at"] = now.isoformat(timespec="seconds")

        if ev["type"] == "meal" and "items" in ev:
            ev["kcal"] = sum(i.get("kcal", 0) for i in ev["items"])
            ev["macros"] = {
                k: round(sum(i.get("macros", {}).get(k, 0) for i in ev["items"]), 1)
                for k in ("p", "c", "g")
            }

        path = DATA / ev["who"] / f"{ts:%Y-%m}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as f:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")
        written.append((ev["id"], ev["type"], str(path.relative_to(ROOT))))

    for id_, type_, path in written:
        print(f"ok {type_} {id_} -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
