// /api/ia-chave — só admin. GET mostra a situação, PUT testa e guarda a chave do Groq.
//
// A permissão sai da tabela `admin`, conferida aqui: esconder a aba na tela é conforto,
// não segurança.
import { rota, corpoJson } from "../lib/rota.js";
import { situacao, cadastrarGroq } from "../lib/ia.js";
import { texto, Recusa } from "../lib/validar.js";
import type { Quem } from "../lib/sessao.js";

function exigirAdmin(quem: Quem) {
  if (!quem.admin) throw new Recusa("só o admin mexe nas chaves de IA", 403);
}

export default rota({
  GET: async (_req, _res, quem) => { exigirAdmin(quem); return situacao(); },
  PUT: async (req, _res, quem) => {
    exigirAdmin(quem);
    return cadastrarGroq(texto(corpoJson(req).chave, "chave", 300), quem.id);
  },
});
