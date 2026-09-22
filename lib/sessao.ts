// Sessão: token opaco em cookie, com linha no banco.
//
// Não é JWT de propósito: com linha, um `delete` desconecta o aparelho na hora, e não
// existe chave de assinatura para guardar nem rotacionar.
import { randomBytes } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { consulta, uma } from "./db.js";

const COOKIE = "fite_sessao";
const DIAS = 90;

export type Quem = {
  id: string;
  email: string;
  nome: string | null;
  admin: boolean;
};

export async function criarSessao(usuario: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await consulta(
    `insert into sessao (token, usuario, expira_em)
     values ($1, $2, now() + ($3 || ' days')::interval)`,
    [token, usuario, String(DIAS)],
  );
  return token;
}

export function porCookie(req: VercelRequest): string | null {
  const cru = req.headers.cookie;
  if (!cru) return null;
  for (const parte of cru.split(";")) {
    const [nome, ...resto] = parte.trim().split("=");
    if (nome === COOKIE) return decodeURIComponent(resto.join("="));
  }
  return null;
}

export function gravarCookie(res: VercelResponse, token: string): void {
  res.setHeader("Set-Cookie", [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${DIAS * 24 * 60 * 60}`,
  ].join("; "));
}

export function limparCookie(res: VercelResponse): void {
  res.setHeader("Set-Cookie",
    `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

/**
 * Quem está logado, ou null. Renova a validade quando a sessão passa da metade da vida
 * — assim quem usa todo dia nunca é deslogado, e quem sumiu por três meses precisa
 * entrar de novo.
 */
export async function quemEstaLogado(req: VercelRequest): Promise<Quem | null> {
  const token = porCookie(req);
  if (!token) return null;
  const linha = await uma<Quem & { renovar: boolean }>(
    `select u.id, u.email, u.nome,
            (a.usuario is not null) as admin,
            (s.expira_em < now() + ($2 || ' days')::interval) as renovar
       from sessao s
       join usuario u on u.id = s.usuario
       left join admin a on a.usuario = u.id
      where s.token = $1 and s.expira_em > now() and u.ativo`,
    [token, String(DIAS / 2)],
  );
  if (!linha) return null;
  if (linha.renovar) {
    await consulta(
      `update sessao set expira_em = now() + ($2 || ' days')::interval where token = $1`,
      [token, String(DIAS)],
    );
  }
  return { id: linha.id, email: linha.email, nome: linha.nome, admin: linha.admin };
}

/** Atalho para rota que exige login. Responde 401 e devolve null se não houver. */
export async function exigirLogin(
  req: VercelRequest, res: VercelResponse,
): Promise<Quem | null> {
  const quem = await quemEstaLogado(req);
  if (!quem) {
    res.status(401).json({ erro: "não autenticado" });
    return null;
  }
  return quem;
}
