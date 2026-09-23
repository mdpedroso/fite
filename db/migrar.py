#!/usr/bin/env python3
"""Leva o fite.json para o Postgres, linha a linha.

    python3 db/migrar.py fite-2026-09-22.json --email mdpedroso@gmail.com

Roda quantas vezes quiser: cada lançamento carrega o id que tinha no arquivo, e o
banco tem índice único sobre ele. Rodar de novo atualiza, não duplica.

A conexão vem de DATABASE_URL (arquivo .env ou variável de ambiente). A string de
conexão nunca entra no repositório.
"""
import argparse, json, os, pathlib, sys

try:
    import psycopg
except ModuleNotFoundError:
    sys.exit("falta o driver: python3 -m pip install 'psycopg[binary]'")


def carrega_env(raiz: pathlib.Path) -> None:
    env = raiz / ".env"
    if not env.exists():
        return
    for linha in env.read_text().splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, valor = linha.split("=", 1)
        os.environ.setdefault(chave.strip(), valor.strip().strip('"').strip("'"))


def inteiro(v) -> int:
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return 0


def migrar(dados: dict, email: str, conn) -> dict:
    conta = dict(refeicoes=0, treinos=0, pesos=0, ignorados=0, apagados=0)
    with conn.cursor() as cur:
        cur.execute("select id from usuario where email = %s", (email,))
        linha = cur.fetchone()
        if not linha:
            sys.exit(f"não existe usuário {email} — crie primeiro com db/criar_usuario.py")
        usuario = linha[0]

        perfil = dados.get("perfil") or {}
        if perfil:
            cur.execute(
                """insert into perfil (usuario, sexo, nascimento, altura_cm, icu_desde)
                   values (%s, %s, %s, %s, %s)
                   on conflict (usuario) do update set
                     sexo = excluded.sexo, nascimento = excluded.nascimento,
                     altura_cm = excluded.altura_cm, icu_desde = excluded.icu_desde""",
                (usuario, perfil.get("sexo"), perfil.get("nasc") or None,
                 inteiro(perfil.get("altura")) or None,
                 (dados.get("treinos") or {}).get("desde") or None))

        # exclusões que o app registrou: viram apagado_em, não some do banco
        apagados = {}
        for dia, marcas in (dados.get("apagados") or {}).items():
            for chave in marcas:
                apagados.setdefault(dia, set()).add(chave)

        for dia, itens in (dados.get("dias") or {}).items():
            for m in itens or []:
                oid = m.get("id")
                morto = oid in apagados.get(dia, set())
                cur.execute(
                    """insert into refeicao
                         (usuario, dia, descricao, bruto, interpretacao,
                          kcal, p, c, g, itens, via, origem_id, apagado_em)
                       values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, case when %s then now() end)
                       on conflict (usuario, origem_id) where origem_id is not null
                       do update set descricao = excluded.descricao, kcal = excluded.kcal,
                         p = excluded.p, c = excluded.c, g = excluded.g,
                         itens = excluded.itens""",
                    (usuario, dia, m.get("desc") or "(sem descrição)",
                     m.get("raw"), m.get("interp"), inteiro(m.get("kc")),
                     inteiro(m.get("p")), inteiro(m.get("c")), inteiro(m.get("g")),
                     json.dumps(m.get("itens")) if m.get("itens") else None,
                     m.get("via"), oid, morto))
                conta["apagados" if morto else "refeicoes"] += 1

        for dia, itens in (dados.get("wk") or {}).items():
            for w in itens or []:
                oid = w.get("id")
                morto = oid in apagados.get(dia, set())
                cur.execute(
                    """insert into treino
                         (usuario, dia, modalidade, titulo, detalhe, bruto,
                          kcal, kcal_medido, icu_id, via, origem_id, apagado_em)
                       values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, case when %s then now() end)
                       on conflict (usuario, origem_id) where origem_id is not null
                       do update set titulo = excluded.titulo, detalhe = excluded.detalhe,
                         kcal = excluded.kcal, modalidade = excluded.modalidade,
                         kcal_medido = excluded.kcal_medido""",
                    (usuario, dia, w.get("mod") or "outro", w.get("t") or "Treino",
                     w.get("m"), w.get("raw"), inteiro(w.get("kc")),
                     bool(w.get("kcMedido")), w.get("icu"), w.get("via"), oid, morto))
                conta["apagados" if morto else "treinos"] += 1

        for p in dados.get("pesos") or []:
            if not p.get("d"):
                continue
            cur.execute(
                """insert into peso (usuario, dia, kg) values (%s,%s,%s)
                   on conflict (usuario, dia) do update set kg = excluded.kg""",
                (usuario, p["d"], p.get("kg")))
            conta["pesos"] += 1

        for dia, v in (dados.get("ocultos") or {}).items():
            if not v:
                continue
            cur.execute(
                """insert into dia_ignorado (usuario, dia) values (%s,%s)
                   on conflict do nothing""", (usuario, dia))
            conta["ignorados"] += 1

    conn.commit()
    return conta


def main() -> None:
    raiz = pathlib.Path(__file__).resolve().parent.parent
    carrega_env(raiz)
    ap = argparse.ArgumentParser(description="importa o fite.json para o Postgres")
    ap.add_argument("arquivo", help="o JSON exportado pelo app")
    ap.add_argument("--email", required=True, help="dono dos lançamentos")
    args = ap.parse_args()

    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("defina DATABASE_URL no .env (ela não entra no repositório)")

    dados = json.loads(pathlib.Path(args.arquivo).read_text())
    with psycopg.connect(url) as conn:
        conta = migrar(dados, args.email, conn)
        with conn.cursor() as cur:
            cur.execute("""select (select count(*) from refeicao where usuario = u.id and apagado_em is null),
                                  (select count(*) from treino   where usuario = u.id and apagado_em is null)
                           from usuario u where u.email = %s""", (args.email,))
            vivos = cur.fetchone()
    print(f"importados: {conta['refeicoes']} refeições, {conta['treinos']} treinos, "
          f"{conta['pesos']} pesos, {conta['ignorados']} dias ignorados, "
          f"{conta['apagados']} marcados como apagados")
    print(f"no banco agora: {vivos[0]} refeições e {vivos[1]} treinos vivos")


if __name__ == "__main__":
    main()
