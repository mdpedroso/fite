// /api/dia — o dia fora da conta ("viajei, não vale"). POST ignora, DELETE volta a contar.
import { rota, q, corpoJson } from "../lib/rota.js";
import { consulta } from "../lib/db.js";
import { dia as validarDia } from "../lib/validar.js";

export default rota({
  POST: async (req, _res, quem) => {
    const d = validarDia(corpoJson(req).dia);
    await consulta(
      `insert into dia_ignorado (usuario, dia) values ($1, $2::date) on conflict do nothing`,
      [quem.id, d]);
    return { dia: d, ignorado: true };
  },

  DELETE: async (req, _res, quem) => {
    const d = validarDia(q(req, "dia") || corpoJson(req).dia);
    await consulta(`delete from dia_ignorado where usuario = $1 and dia = $2::date`, [quem.id, d]);
    return { dia: d, ignorado: false };
  },
});
