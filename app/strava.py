#!/usr/bin/env python3
"""Importa treinos do Strava.

    python3 app/strava.py            # traz o que há de novo
    python3 app/strava.py --desde 2026-09-01

Credenciais ficam em `.strava.json` (NÃO versionado, NÃO vai para o painel):

    {"client_id": "...", "client_secret": "...", "refresh_token": "...",
     "desde": "2026-09-01"}

A saída é um JSON com os treinos por dia, pronto para o painel.
"""
import json, sys, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
CRED = ROOT / ".strava.json"
API = "https://www.strava.com/api/v3"
TZ = ZoneInfo("America/Sao_Paulo")

# tipo do Strava -> modalidade do painel (os ícones seguem essas chaves)
MODALIDADE = {
    "Run": "corrida", "TrailRun": "corrida", "VirtualRun": "corrida",
    "Ride": "bike", "VirtualRide": "bike", "MountainBikeRide": "bike",
    "GravelRide": "bike", "EBikeRide": "bike",
    "Swim": "natacao",
    "WeightTraining": "musculacao",
    "Crossfit": "crossfit",
    "Walk": "caminhada", "Hike": "caminhada",
    "Workout": "funcional", "HighIntensityIntervalTraining": "funcional",
    "Elliptical": "aerobico", "StairStepper": "aerobico", "Rowing": "aerobico",
    "Soccer": "esporte", "Tennis": "esporte", "Basketball": "esporte",
}
NOME = {
    "corrida":"Corrida", "bike":"Bike", "natacao":"Natação",
    "musculacao":"Musculação", "crossfit":"Crossfit", "caminhada":"Caminhada",
    "funcional":"Funcional", "aerobico":"Aeróbico", "esporte":"Esporte",
    "outro":"Treino",
}


def get(url, token=None, **params):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def renovar_token(c):
    """O refresh_token do Strava é rotativo: o novo volta a cada renovação."""
    dados = urllib.parse.urlencode({
        "client_id": c["client_id"], "client_secret": c["client_secret"],
        "grant_type": "refresh_token", "refresh_token": c["refresh_token"],
    }).encode()
    req = urllib.request.Request(f"{API.replace('/api/v3','')}/oauth/token", data=dados)
    with urllib.request.urlopen(req, timeout=30) as r:
        tk = json.load(r)
    if tk.get("refresh_token") and tk["refresh_token"] != c["refresh_token"]:
        c["refresh_token"] = tk["refresh_token"]
        CRED.write_text(json.dumps(c, indent=2, ensure_ascii=False))
    return tk["access_token"]


def duracao(seg):
    h, m = divmod(round(seg / 60), 60)
    return f"{h}h{m:02d}" if h else f"{m} min"


def descrever(a, mod):
    """Uma linha com o que a modalidade tem de característico."""
    partes = []
    km = (a.get("distance") or 0) / 1000
    if km >= 0.2 and mod in ("corrida", "bike", "caminhada", "natacao"):
        partes.append(f"{km:.1f} km".replace(".", ","))
    partes.append(duracao(a.get("moving_time") or 0))
    if mod == "corrida" and a.get("average_speed"):
        s = 1000 / a["average_speed"]
        partes.append(f"{int(s//60)}:{int(s%60):02d} /km")
    if mod == "bike" and a.get("total_elevation_gain"):
        partes.append(f"{round(a['total_elevation_gain'])} m de subida")
    return " · ".join(partes)


def main():
    if not CRED.exists():
        sys.exit(f"erro: falta {CRED.name} — veja o cabeçalho deste arquivo")
    c = json.loads(CRED.read_text())
    desde = c.get("desde")
    if "--desde" in sys.argv:
        desde = sys.argv[sys.argv.index("--desde") + 1]
    if not desde:
        sys.exit("erro: defina 'desde' (YYYY-MM-DD) no .strava.json ou com --desde")

    token = renovar_token(c)
    after = int(datetime.fromisoformat(desde + "T00:00:00")
                .replace(tzinfo=TZ).timestamp())

    atividades, pagina = [], 1
    while True:
        lote = get(f"{API}/athlete/activities", token, after=after,
                   per_page=100, page=pagina)
        if not lote:
            break
        atividades += lote
        if len(lote) < 100:
            break
        pagina += 1

    dias = {}
    for a in atividades:
        mod = MODALIDADE.get(a.get("type") or a.get("sport_type"), "outro")
        # a lista não traz calorias; só o detalhe de cada atividade traz
        try:
            det = get(f"{API}/activities/{a['id']}", token)
        except urllib.error.HTTPError:
            det = a
        kcal = det.get("calories")
        iso = (datetime.fromisoformat(a["start_date"].replace("Z", "+00:00"))
               .astimezone(TZ).date().isoformat())
        dias.setdefault(iso, []).append({
            "mod": mod,
            "t": a.get("name") or NOME[mod],
            "m": descrever(a, mod),
            "kc": round(kcal) if kcal else None,     # None = preciso estimar
            "strava_id": a["id"],
        })

    print(json.dumps({"desde": desde, "total": len(atividades), "dias": dias},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
