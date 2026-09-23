// GET /api/diario?de=2026-09-01&ate=2026-09-30 — tudo que a tela precisa de um período.
//
// Uma chamada só: a tela do dia mostra refeições, treinos, peso e o perfil ao mesmo tempo,
// e cinco viagens de rede no celular do usuário custam mais que cinco consultas aqui.
import { rota, q } from "../lib/rota.js";
import { periodo } from "../lib/diario.js";
import { dia as validarDia } from "../lib/validar.js";
import { hojeISO } from "../lib/db.js";

function trinta(atras: number): string {
  const d = new Date(hojeISO() + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - atras);
  return d.toISOString().slice(0, 10);
}

export default rota({
  GET: async (req, _res, quem) => {
    const de = validarDia(q(req, "de") || trinta(30), "de");
    const ate = validarDia(q(req, "ate") || hojeISO(), "ate");
    return { hoje: hojeISO(), de, ate, ...(await periodo(quem.id, de, ate)) };
  },
});
