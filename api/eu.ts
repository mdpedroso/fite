// GET /api/eu — quem está logado. É o que a tela chama ao abrir.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { quemEstaLogado } from "../lib/sessao.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const quem = await quemEstaLogado(req);
  if (!quem) return res.status(401).json({ erro: "não autenticado" });
  return res.json(quem);
}
