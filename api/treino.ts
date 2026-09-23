// /api/treino — POST cria (ou atualiza, se vier de fora com o mesmo external_id),
// PATCH edita, DELETE marca como apagado.
import { rota, q, corpoJson } from "../lib/rota.js";
import { criarTreino, editar, apagar } from "../lib/diario.js";
import { id as validarId, Recusa } from "../lib/validar.js";

export default rota({
  POST: (req, _res, quem) => criarTreino(quem.id, corpoJson(req)),

  PATCH: async (req, _res, quem) => {
    const corpo = corpoJson(req);
    const alvo = validarId(corpo.id);
    delete corpo.id;
    const r = await editar("treino", quem.id, alvo, corpo);
    if (!r) throw new Recusa("treino não encontrado");
    return r;
  },

  DELETE: async (req, _res, quem) => {
    const r = await apagar("treino", quem.id, validarId(q(req, "id") || corpoJson(req).id));
    if (!r) throw new Recusa("treino não encontrado");
    return r;
  },
});
