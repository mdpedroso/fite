// /api/medicao — PUT grava (uma por dia e métrica), DELETE apaga.
// Peso é `peso_kg`; o catálogo de métricas está em lib/diario.ts.
import { rota, q, corpoJson } from "../lib/rota.js";
import { gravarMedicao, apagarMedicao } from "../lib/diario.js";
import { Recusa } from "../lib/validar.js";

export default rota({
  PUT: (req, _res, quem) => gravarMedicao(quem.id, corpoJson(req)),

  DELETE: async (req, _res, quem) => {
    const corpo = corpoJson(req);
    const r = await apagarMedicao(quem.id,
      String(q(req, "dia") || corpo.dia || ""),
      String(q(req, "metrica") || corpo.metrica || "peso_kg"));
    if (!r) throw new Recusa("medição não encontrada");
    return r;
  },
});
