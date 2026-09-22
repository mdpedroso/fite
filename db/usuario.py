#!/usr/bin/env python3
"""Cadastra ou lista contas. A linha é a permissão: sem ela, ninguém entra.

    .venv/bin/python db/usuario.py --listar
    .venv/bin/python db/usuario.py --add mdpedroso@gmail.com --nome Marcos --admin
    .venv/bin/python db/usuario.py --desativar alguem@exemplo.com

Desativar não apaga: a linha carrega o diário inteiro por causa do on delete cascade.
"""
import argparse, os, pathlib, sys

try:
    import psycopg
except ModuleNotFoundError:
    sys.exit("use o venv: .venv/bin/python db/usuario.py ...")

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from rodar import carrega_env  # noqa: E402


def main() -> None:
    carrega_env()
    ap = argparse.ArgumentParser(description="contas do FiTê")
    ap.add_argument("--listar", action="store_true")
    ap.add_argument("--add", metavar="EMAIL")
    ap.add_argument("--nome")
    ap.add_argument("--admin", action="store_true")
    ap.add_argument("--desativar", metavar="EMAIL")
    ap.add_argument("--reativar", metavar="EMAIL")
    args = ap.parse_args()

    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("falta DATABASE_URL no .env")

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        if args.add:
            cur.execute(
                """insert into usuario (email, nome) values (%s, %s)
                   on conflict (email) do update set nome = coalesce(excluded.nome, usuario.nome)
                   returning id""", (args.add, args.nome))
            uid = cur.fetchone()[0]
            if args.admin:
                cur.execute("insert into admin (usuario) values (%s) on conflict do nothing", (uid,))
            print(f"ok: {args.add}{' (admin)' if args.admin else ''}")
        if args.desativar:
            cur.execute("update usuario set ativo = false where email = %s", (args.desativar,))
            print(f"desativado: {args.desativar} ({cur.rowcount} linha)")
        if args.reativar:
            cur.execute("update usuario set ativo = true where email = %s", (args.reativar,))
            print(f"reativado: {args.reativar} ({cur.rowcount} linha)")
        conn.commit()

        cur.execute("""select u.email, coalesce(u.nome,'—') as nome, u.ativo,
                              (a.usuario is not null) as admin,
                              (u.google_sub is not null) as google
                         from usuario u left join admin a on a.usuario = u.id
                        order by u.criado_em""")
        linhas = cur.fetchall()
    if not linhas:
        print("nenhuma conta cadastrada")
        return
    print(f"{'email':32} {'nome':12} {'ativo':6} {'admin':6} google")
    for email, nome, ativo, adm, goog in linhas:
        print(f"{email:32} {nome:12} {str(ativo):6} {str(adm):6} {goog}")


if __name__ == "__main__":
    main()
