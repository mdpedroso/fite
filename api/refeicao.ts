// /api/refeicao — POST cria, PATCH edita, DELETE marca como apagada.
import { rota, q, corpoJson } from "../lib/rota.js";
import { criarRefeicao, editar, apagar } from "../lib/diario.js";
import { id as validarId } from "../lib/validar.js";
import { Recusa } from "../lib/validar.js";

export default rota({
  POST: (req, _res, quem) => criarRefeicao(quem.id, corpoJson(req)),

  PATCH: async (req, _res, quem) => {
    const corpo = corpoJson(req);
    const alvo = validarId(corpo.id);
    delete corpo.id;
    const r = await editar("refeicao", quem.id, alvo, corpo);
    if (!r) throw new Recusa("refeição não encontrada");
    return r;
  },

  DELETE: async (req, _res, quem) => {
    const r = await apagar("refeicao", quem.id, validarId(q(req, "id") || corpoJson(req).id));
    if (!r) throw new Recusa("refeição não encontrada");
    return r;
  },
});
