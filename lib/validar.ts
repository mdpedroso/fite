// Validação da entrada das rotas.
//
// Nada que veio do navegador entra numa consulta sem passar por aqui. Não é paranoia com
// injeção — as consultas são parametrizadas —, é evitar que um `undefined` ou um texto
// gigante vire linha no banco e só apareça como problema meses depois.

// 400 por padrão: o dado foi recusado e repetir não adianta. 503 quando o problema é
// passageiro do nosso lado (IA sem chave, fora do ar) — o app tenta de novo sozinho.
export class Recusa extends Error {
  constructor(msg: string, readonly status = 400) { super(msg); }
}

export function texto(v: unknown, campo: string, max = 2000): string {
  if (typeof v !== "string") throw new Recusa(`${campo} precisa ser texto`);
  const t = v.trim();
  if (!t) throw new Recusa(`${campo} está vazio`);
  if (t.length > max) throw new Recusa(`${campo} passa de ${max} caracteres`);
  return t;
}

export function textoOpcional(v: unknown, campo: string, max = 2000): string | null {
  if (v === null || v === undefined || v === "") return null;
  return texto(v, campo, max);
}

/** Inteiro não negativo. kcal e macros nunca são negativos nem fracionários no banco. */
export function inteiro(v: unknown, campo: string, max = 100000): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new Recusa(`${campo} precisa ser número`);
  const i = Math.round(n);
  if (i < 0 || i > max) throw new Recusa(`${campo} fora da faixa`);
  return i;
}

export function numero(v: unknown, campo: string, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) throw new Recusa(`${campo} precisa ser número`);
  if (n < min || n > max) throw new Recusa(`${campo} fora da faixa (${min} a ${max})`);
  return n;
}

// Só o formato ISO é aceito: o banco está com DateStyle MDY, e "09/10" seria adivinhação.
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function dia(v: unknown, campo = "dia"): string {
  if (typeof v !== "string" || !ISO.test(v)) throw new Recusa(`${campo} precisa ser AAAA-MM-DD`);
  const d = new Date(v + "T12:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v)
    throw new Recusa(`${campo} não existe no calendário`);
  return v;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function id(v: unknown, campo = "id"): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new Recusa(`${campo} inválido`);
  return v;
}

/** Um valor de uma lista fechada, ou o padrão. Serve para slot, modalidade e fonte. */
export function daLista<T extends string>(v: unknown, lista: readonly T[], padrao: T): T {
  if (typeof v !== "string") return padrao;
  const achou = lista.find(x => x === v.toLowerCase());
  return achou ?? padrao;
}
