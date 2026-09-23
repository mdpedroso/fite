// /api/perfil — GET lê, PUT grava. Sexo, nascimento, altura e fator de rotina entram na
// conta do gasto basal; `externo_desde` é a partir de quando buscar treino no intervals.
import { rota, corpoJson } from "../lib/rota.js";
import { uma } from "../lib/db.js";
import { dia as validarDia, numero, inteiro, Recusa } from "../lib/validar.js";

const CAMPOS = `sexo, to_char(nascimento,'YYYY-MM-DD') as nascimento, altura_cm,
                fator_rotina::float8 as fator_rotina,
                to_char(externo_desde,'YYYY-MM-DD') as externo_desde`;

export default rota({
  GET: async (_req, _res, quem) =>
    (await uma(`select ${CAMPOS} from perfil where usuario = $1`, [quem.id])) ?? {},

  PUT: async (req, _res, quem) => {
    const c = corpoJson(req);
    const sexo = c.sexo === null || c.sexo === undefined ? null : String(c.sexo).toLowerCase();
    if (sexo !== null && sexo !== "m" && sexo !== "f") throw new Recusa("sexo precisa ser m ou f");
    const valores = [
      quem.id, sexo,
      c.nascimento ? validarDia(c.nascimento, "nascimento") : null,
      c.altura_cm === null || c.altura_cm === undefined ? null : inteiro(c.altura_cm, "altura", 250),
      c.fator_rotina === undefined ? 1.4 : numero(c.fator_rotina, "fator de rotina", 1, 2.5),
      c.externo_desde ? validarDia(c.externo_desde, "externo desde") : null,
    ];
    return uma(
      `insert into perfil (usuario, sexo, nascimento, altura_cm, fator_rotina, externo_desde)
       values ($1,$2,$3::date,$4,$5,$6::date)
       on conflict (usuario) do update set
         sexo = excluded.sexo, nascimento = excluded.nascimento,
         altura_cm = excluded.altura_cm, fator_rotina = excluded.fator_rotina,
         externo_desde = excluded.externo_desde
       returning ${CAMPOS}`, valores);
  },
});
