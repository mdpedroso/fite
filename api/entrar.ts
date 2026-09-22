// POST /api/entrar  { credential: "<ID token do Google>" }
//
// A linha em `usuario` é a permissão: e-mail sem linha cadastrada é recusado, mesmo com
// conta Google válida. Aqui só carimbamos o `google_sub` e abrimos a sessão.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { uma, consulta } from "../lib/db.js";
import { validarIdToken } from "../lib/google.js";
import { criarSessao, gravarCookie } from "../lib/sessao.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ erro: "use POST" });

  const credential = (req.body as { credential?: string } | undefined)?.credential;
  if (!credential) return res.status(400).json({ erro: "falta credential" });

  let id;
  try {
    id = await validarIdToken(credential);
  } catch (e) {
    return res.status(401).json({ erro: (e as Error).message });
  }

  const usuario = await uma<{ id: string; nome: string | null; google_sub: string | null }>(
    `select id, nome, google_sub from usuario where email = $1 and ativo`,
    [id.email],
  );
  if (!usuario) {
    return res.status(403).json({
      erro: `${id.email} não está liberado neste app. Peça para ser incluído.`,
    });
  }

  // Primeiro login: carimba o sub e aproveita o nome do Google se ainda não houver.
  if (usuario.google_sub !== id.sub) {
    await consulta(
      `update usuario set google_sub = $2, nome = coalesce(nome, $3) where id = $1`,
      [usuario.id, id.sub, id.nome],
    );
  }

  const token = await criarSessao(usuario.id);
  gravarCookie(res, token);

  const admin = await uma(`select 1 from admin where usuario = $1`, [usuario.id]);
  return res.json({
    email: id.email,
    nome: usuario.nome ?? id.nome,
    admin: Boolean(admin),
  });
}
