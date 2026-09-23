// intervals.icu — de onde vêm os treinos que o Garmin manda para lá.
//
// A busca acontece aqui, não no navegador: assim a chave nunca sai do servidor e importar
// não depende de alguém abrir o app.
import { consulta, uma } from "./db.js";
import { criarTreino, MODALIDADES } from "./diario.js";
import { Recusa } from "./validar.js";

const ICU = "https://intervals.icu/api/v1";

// os tipos são os do Strava/Garmin, que o intervals.icu repassa
const MOD: Record<string, string> = {
  Run: "corrida", TrailRun: "corrida", VirtualRun: "corrida", Treadmill: "corrida",
  Ride: "bike", VirtualRide: "bike", MountainBikeRide: "bike", GravelRide: "bike", EBikeRide: "bike",
  Swim: "natacao", OpenWaterSwim: "natacao", WeightTraining: "musculacao", Crossfit: "crossfit",
  Walk: "caminhada", Hike: "caminhada",
  Workout: "funcional", HighIntensityIntervalTraining: "funcional",
  Elliptical: "aerobico", StairStepper: "aerobico", Rowing: "aerobico",
  Soccer: "esporte", Tennis: "esporte", Basketball: "esporte",
};
const NOME: Record<string, string> = {
  corrida: "Corrida", bike: "Pedal", natacao: "Natação", musculacao: "Musculação",
  crossfit: "Crossfit", caminhada: "Caminhada", funcional: "Funcional",
  aerobico: "Aeróbico", esporte: "Esporte", outro: "Treino",
};
const MET: Record<string, number> = {
  corrida: 9.8, bike: 7.5, natacao: 7.0, musculacao: 5.0, crossfit: 8.0,
  caminhada: 3.5, funcional: 6.0, aerobico: 6.5, esporte: 7.0, outro: 5.5,
};

// usuário fixo "API_KEY", como a documentação do intervals.icu manda
const cabecalho = (chave: string) =>
  ({ Authorization: "Basic " + Buffer.from("API_KEY:" + chave).toString("base64") });

async function pegar(caminho: string, chave: string): Promise<any> {
  const r = await fetch(ICU + caminho, {
    headers: cabecalho(chave), signal: AbortSignal.timeout(25_000),
  });
  if (r.status === 401 || r.status === 403) throw new Recusa("o intervals.icu recusou a chave");
  if (!r.ok) throw new Recusa(`intervals.icu respondeu ${r.status}`);
  return r.json();
}

export type Conta = { chave: string; externo_id: string | null; rotulo: string | null; ultima_busca: string | null };

export const contaDe = (usuario: string) =>
  uma<Conta>(`select chave, externo_id, rotulo, ultima_busca
                from integracao where usuario = $1 and servico = 'intervals'`, [usuario]);

/** Confere a chave contra o serviço antes de guardar: chave errada tem que falhar agora. */
export async function conectar(usuario: string, chave: string) {
  const atleta = await pegar("/athlete/0", chave);   // 0 = o dono da chave
  const rotulo = String(atleta?.name || atleta?.id || "conectado");
  await consulta(
    `insert into integracao (usuario, servico, chave, externo_id, rotulo)
     values ($1, 'intervals', $2, $3, $4)
     on conflict (usuario, servico) do update set
       chave = excluded.chave, externo_id = excluded.externo_id, rotulo = excluded.rotulo`,
    [usuario, chave, atleta?.id ? String(atleta.id) : null, rotulo]);
  return { conectado: true, rotulo };
}

/** Peso vigente num dia: o último pesado até ele; antes da primeira pesagem, a primeira. */
function pesoVigente(pesos: { dia: string; valor: number }[], dia: string): number {
  let v = pesos[0]?.valor ?? 75;
  for (const p of pesos) { if (p.dia > dia) break; v = p.valor; }
  return v;
}

function montar(a: any, pesos: { dia: string; valor: number }[]) {
  const dia = String(a.start_date_local || a.start_date || "").slice(0, 10);
  const modalidade = MOD[a.type] || "outro";
  const km = (a.distance || 0) / 1000;
  const min = Math.round((a.moving_time || a.elapsed_time || 0) / 60);

  const det: string[] = [];
  if (km >= 0.2 && ["corrida", "bike", "caminhada", "natacao"].includes(modalidade))
    det.push(km.toFixed(1).replace(".", ",") + " km");
  if (min) det.push(min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}` : `${min} min`);
  if (modalidade === "corrida" && a.average_speed) {
    const sp = Math.round(1000 / a.average_speed);
    det.push(`${Math.floor(sp / 60)}:${String(sp % 60).padStart(2, "0")} /km`);
  }

  // caloria do relógio manda; sem ela, MET × peso do dia × tempo
  const medido = Number(a.calories) > 0;
  const kcal = medido ? Math.round(a.calories)
    : min ? Math.round((MET[modalidade] ?? 5.5) * 3.5 * pesoVigente(pesos, dia) / 200 * min)
    : 0;

  return {
    dia, modalidade, titulo: String(a.name || NOME[modalidade] || "Treino"),
    detalhe: det.join(" · ") || null, bruto: a.name ? String(a.name) : null,
    kcal, kcal_medido: medido,
    fonte: "intervals", external_id: String(a.id),
    // sem nome, sem tipo e sem tempo: o intervals.icu ainda não recebeu os dados do Garmin
    casca: !a.name && !a.type && !min,
  };
}

export async function sincronizar(usuario: string, desde: string) {
  const conta = await contaDe(usuario);
  if (!conta) throw new Recusa("intervals.icu não está conectado");

  const campos = "id,name,type,start_date_local,start_date,moving_time,elapsed_time," +
                 "distance,calories,average_speed";
  const lista: any[] = await pegar(
    `/athlete/0/activities?oldest=${desde}&limit=500&fields=${campos}`, conta.chave);

  const pesos = await consulta<{ dia: string; valor: number }>(
    `select to_char(dia,'YYYY-MM-DD') as dia, valor::float8 as valor from medicao
      where usuario = $1 and metrica = 'peso_kg' and apagado_em is null order by dia`, [usuario]);

  let gravados = 0, cascas = 0;
  for (const a of lista) {
    const t = montar(a, pesos);
    if (!t.dia) continue;
    // casca não vira linha: entraria como "outro" sem caloria e ficaria assim para sempre
    if (t.casca) { cascas++; continue; }
    const { casca, ...treino } = t;
    if (!MODALIDADES.includes(treino.modalidade as any)) treino.modalidade = "outro";
    // null = a pessoa apagou esse treino; continua apagado
    if (await criarTreino(usuario, treino)) gravados++;
  }

  await consulta(
    `update integracao set ultima_busca = now() where usuario = $1 and servico = 'intervals'`,
    [usuario]);
  return { gravados, cascas, desde, atividades: lista.length };
}
