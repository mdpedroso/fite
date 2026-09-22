// POST /api/sair — apaga a sessão deste aparelho. Com token opaco, sair é de verdade.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { consulta } from "../lib/db.js";
import { porCookie, limparCookie } from "../lib/sessao.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ erro: "use POST" });
  const token = porCookie(req);
  if (token) await consulta(`delete from sessao where token = $1`, [token]);
  limparCookie(res);
  return res.json({ ok: true });
}
