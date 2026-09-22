#!/usr/bin/env python3
"""Roda SQL no banco do projeto e mostra o resultado.

    .venv/bin/python db/rodar.py db/esquema.sql       # aplica um arquivo
    .venv/bin/python db/rodar.py -c "select now()"    # uma consulta solta
    .venv/bin/python db/rodar.py --tabelas            # o que existe hoje

DDL só entra aqui depois de aprovada — a regra está no CLAUDE.md.
A conexão vem de DATABASE_URL (.env), nunca de argumento.
"""
import argparse, os, pathlib, sys

try:
    import psycopg
except ModuleNotFoundError:
    sys.exit("use o venv: .venv/bin/python db/rodar.py ...")

RAIZ = pathlib.Path(__file__).resolve().parent.parent


def carrega_env() -> None:
    env = RAIZ / ".env"
    if not env.exists():
        return
    for linha in env.read_text().splitlines():
        linha = linha.strip()
        if linha and not linha.startswith("#") and "=" in linha:
            k, v = linha.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


TABELAS = """
select table_name,
       (select count(*) from information_schema.columns c
         where c.table_name = t.table_name and c.table_schema = 'public') as colunas
  from information_schema.tables t
 where table_schema = 'public' and table_type = 'BASE TABLE'
 order by table_name
"""


def main() -> None:
    carrega_env()
    ap = argparse.ArgumentParser(description="roda SQL no Postgres do FiTê")
    ap.add_argument("arquivo", nargs="?", help="arquivo .sql")
    ap.add_argument("-c", "--comando", help="SQL direto")
    ap.add_argument("--tabelas", action="store_true", help="lista as tabelas")
    args = ap.parse_args()

    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("falta DATABASE_URL no .env")

    sql = TABELAS if args.tabelas else (args.comando or
          (pathlib.Path(args.arquivo).read_text() if args.arquivo else None))
    if not sql:
        sys.exit("passe um arquivo, -c ou --tabelas")

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(sql)
        while True:
            if cur.description:
                largura = [len(d.name) for d in cur.description]
                linhas = cur.fetchall()
                for l in linhas:
                    largura = [max(w, len(str(v))) for w, v in zip(largura, l)]
                cab = " | ".join(d.name.ljust(w) for d, w in zip(cur.description, largura))
                print(cab); print("-" * len(cab))
                for l in linhas:
                    print(" | ".join(str(v).ljust(w) for v, w in zip(l, largura)))
                print(f"({len(linhas)} linha{'s' if len(linhas) != 1 else ''})")
            elif cur.rowcount >= 0:
                print(f"ok, {cur.rowcount} linha(s) afetada(s)" if cur.rowcount else "ok")
            if not cur.nextset():
                break
        conn.commit()


if __name__ == "__main__":
    main()
