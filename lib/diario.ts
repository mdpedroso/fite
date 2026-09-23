// O diário: leitura de um período e escrita de um lançamento.
//
// Toda consulta aqui recebe o `usuario` de quem está logado, vindo do cookie — nunca da
// tela. É a regra que segura tudo: se a tela pudesse pedir "os dados de fulano", não
// haveria separação nenhuma entre as duas pessoas do app.
import { consulta, uma } from "./db.js";
import { Recusa, texto, textoOpcional, inteiro, numero, dia as validarDia, daLista } from "./validar.js";

// As mesmas do app: mudar aqui sem mudar lá faria o treino chegar como "outro".
export const MODALIDADES = ["corrida", "bike", "natacao", "musculacao", "crossfit",
  "caminhada", "funcional", "aerobico", "esporte", "outro"] as const;

// O catálogo de métricas mora aqui, não no banco: incluir "gordura_pct" amanhã é uma linha
// neste objeto, sem migração.
export const METRICAS = {
  peso_kg: { rotulo: "Peso", unidade: "kg", min: 20, max: 400, casas: 1 },
} as const;
export type Metrica = keyof typeof METRICAS;

export type Refeicao = {
  id: string; dia: string; ordem: number;
  descricao: string; bruto: string | null; interpretacao: string | null;
  kcal: number; p: number; c: number; g: number;
  itens: { n: string; kc: number }[] | null;
  foto_url: string | null; llm: string | null;
};

export type Treino = {
  id: string; dia: string; ordem: number; modalidade: string;
  titulo: string; detalhe: string | null; bruto: string | null;
  kcal: number; kcal_medido: boolean;
  fonte: string | null; external_id: string | null;
  foto_url: string | null; llm: string | null;
};

export type Medicao = { dia: string; metrica: string; valor: number };

export type Periodo = {
  refeicoes: Refeicao[];
  treinos: Treino[];
  medicoes: Medicao[];
  ignorados: string[];
  perfil: Record<string, unknown> | null;
};

// `to_char` em vez do objeto Date do driver: o pg devolveria `date` como Date em UTC, e
// 2026-09-22 viraria 21/09 na hora de formatar no navegador.
const DIA = `to_char(dia, 'YYYY-MM-DD') as dia`;

export async function periodo(usuario: string, de: string, ate: string): Promise<Periodo> {
  const [refeicoes, treinos, medicoes, ignorados, perfil] = await Promise.all([
    consulta<Refeicao>(
      `select id, ${DIA}, ordem, descricao, bruto, interpretacao,
              kcal, p, c, g, itens, foto_url, llm
         from refeicao
        where usuario = $1 and dia between $2::date and $3::date and apagado_em is null
        order by dia, ordem, criado_em`, [usuario, de, ate]),
    consulta<Treino>(
      `select id, ${DIA}, ordem, modalidade, titulo, detalhe, bruto,
              kcal, kcal_medido, fonte, external_id, foto_url, llm
         from treino
        where usuario = $1 and dia between $2::date and $3::date and apagado_em is null
        order by dia, ordem, criado_em`, [usuario, de, ate]),
    // medição vem inteira: o gráfico de peso precisa do histórico, não só do período
    consulta<Medicao>(
      `select ${DIA}, metrica, valor::float8 as valor
         from medicao where usuario = $1 and apagado_em is null order by dia`, [usuario]),
    consulta<{ dia: string }>(
      `select ${DIA} from dia_ignorado where usuario = $1`, [usuario]),
    uma(`select sexo, to_char(nascimento,'YYYY-MM-DD') as nascimento, altura_cm,
                fator_rotina::float8 as fator_rotina,
                to_char(externo_desde,'YYYY-MM-DD') as externo_desde
           from perfil where usuario = $1`, [usuario]),
  ]);
  return { refeicoes, treinos, medicoes, ignorados: ignorados.map(x => x.dia), perfil };
}

/** Próxima posição livre do dia. Lançamento novo entra no fim da lista. */
async function proximaOrdem(tabela: "refeicao" | "treino", usuario: string, dia: string) {
  const r = await uma<{ n: number }>(
    `select coalesce(max(ordem), -1) + 1 as n from ${tabela}
      where usuario = $1 and dia = $2::date and apagado_em is null`, [usuario, dia]);
  return Math.min(r?.n ?? 0, 32000);
}

export function lerRefeicao(corpo: Record<string, unknown>) {
  return {
    dia: validarDia(corpo.dia),
    descricao: texto(corpo.descricao, "descrição", 500),
    bruto: textoOpcional(corpo.bruto, "texto original", 2000),
    interpretacao: textoOpcional(corpo.interpretacao, "interpretação", 2000),
    kcal: inteiro(corpo.kcal ?? 0, "kcal", 20000),
    p: inteiro(corpo.p ?? 0, "proteína", 2000),
    c: inteiro(corpo.c ?? 0, "carboidrato", 2000),
    g: inteiro(corpo.g ?? 0, "gordura", 2000),
    itens: lerItens(corpo.itens),
    foto_url: textoOpcional(corpo.foto_url, "foto", 1000),
    llm: textoOpcional(corpo.llm, "modelo", 120),
  };
}

function lerItens(v: unknown) {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) throw new Recusa("itens precisa ser lista");
  if (v.length > 60) throw new Recusa("itens demais");
  return v.map(i => ({
    n: texto((i as any)?.n, "nome do item", 200),
    kc: inteiro((i as any)?.kc ?? 0, "kcal do item", 20000),
  }));
}

export async function criarRefeicao(usuario: string, corpo: Record<string, unknown>) {
  const d = lerRefeicao(corpo);
  const ordem = await proximaOrdem("refeicao", usuario, d.dia);
  return uma<Refeicao>(
    `insert into refeicao (usuario, dia, ordem, descricao, bruto, interpretacao,
                           kcal, p, c, g, itens, foto_url, llm)
     values ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     returning id, ${DIA}, ordem, descricao, bruto, interpretacao,
               kcal, p, c, g, itens, foto_url, llm`,
    [usuario, d.dia, ordem, d.descricao, d.bruto, d.interpretacao,
     d.kcal, d.p, d.c, d.g, d.itens ? JSON.stringify(d.itens) : null, d.foto_url, d.llm]);
}

export function lerTreino(corpo: Record<string, unknown>) {
  return {
    dia: validarDia(corpo.dia),
    modalidade: daLista(corpo.modalidade, MODALIDADES, "outro"),
    titulo: texto(corpo.titulo, "título", 300),
    detalhe: textoOpcional(corpo.detalhe, "detalhe", 500),
    bruto: textoOpcional(corpo.bruto, "texto original", 2000),
    kcal: inteiro(corpo.kcal ?? 0, "kcal", 20000),
    kcal_medido: Boolean(corpo.kcal_medido),
    fonte: textoOpcional(corpo.fonte, "fonte", 40),
    external_id: textoOpcional(corpo.external_id, "id externo", 120),
    foto_url: textoOpcional(corpo.foto_url, "foto", 1000),
    llm: textoOpcional(corpo.llm, "modelo", 120),
  };
}

export async function criarTreino(usuario: string, corpo: Record<string, unknown>) {
  const d = lerTreino(corpo);
  const ordem = await proximaOrdem("treino", usuario, d.dia);
  // vindo de fora (intervals), o mesmo treino pode chegar duas vezes: o índice único
  // (usuario, fonte, external_id) transforma a segunda vez em atualização. Se a pessoa
  // apagou o treino, a linha fica como está: reimportar não é desfazer a exclusão.
  // Nesse caso não volta linha nenhuma (null).
  return uma<Treino>(
    `insert into treino (usuario, dia, ordem, modalidade, titulo, detalhe, bruto,
                         kcal, kcal_medido, fonte, external_id, foto_url, llm)
     values ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (usuario, fonte, external_id) where external_id is not null
     do update set dia = excluded.dia, titulo = excluded.titulo, detalhe = excluded.detalhe,
                   modalidade = excluded.modalidade, kcal = excluded.kcal,
                   kcal_medido = excluded.kcal_medido
       where treino.apagado_em is null
     returning id, ${DIA}, ordem, modalidade, titulo, detalhe, bruto,
               kcal, kcal_medido, fonte, external_id, foto_url, llm`,
    [usuario, d.dia, ordem, d.modalidade, d.titulo, d.detalhe, d.bruto,
     d.kcal, d.kcal_medido, d.fonte, d.external_id, d.foto_url, d.llm]);
}

/**
 * Edição parcial: só os campos que vieram mudam. Cada campo é validado do mesmo jeito
 * que na criação — editar não é caminho mais frouxo que criar.
 */
export async function editar(
  tabela: "refeicao" | "treino", usuario: string, id: string, corpo: Record<string, unknown>,
) {
  const permitidos = tabela === "refeicao"
    ? { dia: "dia", descricao: "descricao", bruto: "bruto",
        interpretacao: "interpretacao", kcal: "kcal", p: "p", c: "c", g: "g",
        itens: "itens", foto_url: "foto_url", llm: "llm", ordem: "ordem" }
    : { dia: "dia", modalidade: "modalidade", titulo: "titulo", detalhe: "detalhe",
        bruto: "bruto", kcal: "kcal", kcal_medido: "kcal_medido", foto_url: "foto_url",
        llm: "llm", ordem: "ordem" };

  const campos: string[] = [], valores: unknown[] = [usuario, id];
  const inteiro_ = (k: string, max: number) => inteiro(corpo[k], k, max);

  for (const chave of Object.keys(corpo)) {
    if (!(chave in permitidos)) continue;
    let valor: unknown;
    switch (chave) {
      case "dia":         valor = validarDia(corpo.dia); break;
      case "modalidade":  valor = daLista(corpo.modalidade, MODALIDADES, "outro"); break;
      case "descricao":   valor = texto(corpo.descricao, "descrição", 500); break;
      case "titulo":      valor = texto(corpo.titulo, "título", 300); break;
      case "detalhe":
      case "bruto":
      case "interpretacao":
      case "foto_url":
      case "llm":         valor = textoOpcional(corpo[chave], chave, 2000); break;
      case "kcal":        valor = inteiro_("kcal", 20000); break;
      case "p": case "c": case "g": valor = inteiro_(chave, 2000); break;
      case "ordem":       valor = inteiro_("ordem", 32000); break;
      case "kcal_medido": valor = Boolean(corpo.kcal_medido); break;
      case "itens":       valor = lerItens(corpo.itens); valor = valor ? JSON.stringify(valor) : null; break;
      default: continue;
    }
    valores.push(valor);
    campos.push(`${chave} = $${valores.length}${chave === "dia" ? "::date" : ""}`);
  }
  if (!campos.length) throw new Recusa("nada para mudar");

  return uma(
    `update ${tabela} set ${campos.join(", ")}
      where usuario = $1 and id = $2 and apagado_em is null
      returning id`, valores);
}

/** Apagar é marcar. A linha fica, e é o que permite descobrir depois o que sumiu e quando. */
export async function apagar(tabela: "refeicao" | "treino", usuario: string, id: string) {
  return uma(
    `update ${tabela} set apagado_em = now()
      where usuario = $1 and id = $2 and apagado_em is null returning id`, [usuario, id]);
}

export async function gravarMedicao(usuario: string, corpo: Record<string, unknown>) {
  const d = validarDia(corpo.dia);
  const metrica = String(corpo.metrica ?? "peso_kg");
  const cat = METRICAS[metrica as Metrica];
  if (!cat) throw new Recusa(`métrica desconhecida: ${metrica}`);
  const valor = numero(corpo.valor, cat.rotulo, cat.min, cat.max);
  return uma<Medicao>(
    `insert into medicao (usuario, dia, metrica, valor) values ($1,$2::date,$3,$4)
     on conflict (usuario, dia, metrica)
     do update set valor = excluded.valor, apagado_em = null
     returning ${DIA}, metrica, valor::float8 as valor`,
    [usuario, d, metrica, valor]);
}

export async function apagarMedicao(usuario: string, diaISO: string, metrica: string) {
  return uma(
    `update medicao set apagado_em = now()
      where usuario = $1 and dia = $2::date and metrica = $3 and apagado_em is null
      returning dia`, [usuario, validarDia(diaISO), metrica]);
}
