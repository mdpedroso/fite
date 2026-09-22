#!/usr/bin/env python3
"""Cria (ou troca a senha de) uma conta.

    python3 db/criar_usuario.py --email mdpedroso@gmail.com --nome Marcos --dono

A senha é pedida no terminal, nunca vem por argumento — argumento fica no histórico
do shell e na lista de processos. Guardamos só o hash argon2id.
"""
import argparse, getpass, os, pathlib, sys

try:
    import psycopg
    from argon2 import PasswordHasher
except ModuleNotFoundError as e:
    sys.exit(f"falta dependência ({e.name}): python3 -m pip install 'psycopg[binary]' argon2-cffi")

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from migrar import carrega_env  # noqa: E402


def main() -> None:
    raiz = pathlib.Path(__file__).resolve().parent.parent
    carrega_env(raiz)
    ap = argparse.ArgumentParser(description="cria ou atualiza uma conta do FiTê")
    ap.add_argument("--email", required=True)
    ap.add_argument("--nome")
    ap.add_argument("--dono", action="store_true", help="pode mexer nas chaves de IA")
    args = ap.parse_args()

    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("defina DATABASE_URL no .env")

    senha = getpass.getpass("senha: ")
    if len(senha) < 8:
        sys.exit("senha curta demais (mínimo 8)")
    if senha != getpass.getpass("de novo: "):
        sys.exit("as duas não bateram")

    # parâmetros acima do padrão da biblioteca: são duas contas, dá para pagar o custo
    ph = PasswordHasher(time_cost=3, memory_cost=64 * 1024, parallelism=4)
    hash_ = ph.hash(senha)
    papel = "dono" if args.dono else "pessoa"

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            """insert into usuario (email, senha_hash, nome, papel)
               values (%s, %s, %s, %s)
               on conflict (email) do update set
                 senha_hash = excluded.senha_hash,
                 nome = coalesce(excluded.nome, usuario.nome),
                 papel = excluded.papel
               returning id, (xmax = 0) as novo""",
            (args.email, hash_, args.nome, papel))
        uid, novo = cur.fetchone()
        conn.commit()
    print(f"{'criado' if novo else 'senha atualizada'}: {args.email} ({papel}) — {uid}")


if __name__ == "__main__":
    main()
