// /api/intervals — GET diz se está conectado, PUT guarda a chave, POST busca os treinos.
//
// A chave fica no banco, não no aparelho: importar deixa de depender de qual celular está
// aberto, e ninguém precisa colar a chave de novo a cada troca de telefone.
import { rota, corpoJson } from "../lib/rota.js";
import { uma } from "../lib/db.js";
import { contaDe, conectar, sincronizar } from "../lib/intervals.js";
import { texto, dia as validarDia } from "../lib/validar.js";

export default rota({
  GET: async (_req, _res, quem) => {
    const c = await contaDe(quem.id);
    return {
      conectado: !!c, rotulo: c?.rotulo ?? null, ultima_busca: c?.ultima_busca ?? null,
      desde: (await uma<{ d: string }>(
        `select to_char(externo_desde,'YYYY-MM-DD') as d from perfil where usuario = $1`,
        [quem.id]))?.d ?? null,
    };
  },

  PUT: (req, _res, quem) => conectar(quem.id, texto(corpoJson(req).chave, "chave", 200)),

  POST: async (req, _res, quem) => {
    const corpo = corpoJson(req);
    const perfil = await uma<{ d: string | null }>(
      `select to_char(externo_desde,'YYYY-MM-DD') as d from perfil where usuario = $1`, [quem.id]);
    const desde = corpo.desde ? validarDia(corpo.desde, "desde")
      : perfil?.d ?? new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    return sincronizar(quem.id, desde);
  },
});
