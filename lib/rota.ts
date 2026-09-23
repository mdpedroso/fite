// Casca comum das rotas do diário: exige login, chama o corpo e traduz erro em resposta.
//
// Sem isto, cada rota repetiria o mesmo try/catch — e é justamente o lugar onde esquecer
// uma linha significa devolver 500 com detalhe interno para o navegador.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exigirLogin, type Quem } from "./sessao.js";
import { Recusa } from "./validar.js";

type Corpo = (req: VercelRequest, res: VercelResponse, quem: Quem) => Promise<unknown>;

export function rota(metodos: Record<string, Corpo>) {
  return async (req: VercelRequest, res: VercelResponse) => {
    const corpo = metodos[(req.method || "GET").toUpperCase()];
    if (!corpo) return res.status(405).json({ erro: "método não aceito aqui" });

    const quem = await exigirLogin(req, res);
    if (!quem) return;

    try {
      const saida = await corpo(req, res, quem);
      if (!res.headersSent) res.json(saida ?? { ok: true });
    } catch (e) {
      if (e instanceof Recusa) return res.status(e.status).json({ erro: e.message });
      // A mensagem do Postgres pode carregar nome de coluna e trecho de consulta: fica no
      // log do servidor, não na tela.
      console.error(req.url, e);
      res.status(500).json({ erro: "falhou aqui do lado; tente de novo" });
    }
  };
}

/** Parâmetro de query como texto simples (o Vercel entrega array quando repete). */
export function q(req: VercelRequest, nome: string): string {
  const v = req.query[nome];
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export function corpoJson(req: VercelRequest): Record<string, unknown> {
  const b = req.body;
  if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, unknown>;
  if (typeof b === "string") { try { return JSON.parse(b); } catch { /* cai no vazio */ } }
  return {};
}
