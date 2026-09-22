// Conexão com o Postgres do Supabase.
//
// Em função serverless cada invocação pode ser um processo novo, mas o Node reaproveita
// o módulo enquanto a instância está quente — por isso o pool fica no escopo do módulo.
// A URL usada aqui é a do pooler de transação (porta 6543): conexão direta esgotaria o
// limite do Postgres com dezenas de funções abrindo socket ao mesmo tempo.
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("falta DATABASE_URL");

// O Supabase corta a conexão sem aviso quando ela fica parada; pool pequeno e
// idleTimeout curto evitam segurar socket morto entre uma requisição e outra.
export const pool = new pg.Pool({
  connectionString: url,
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 8_000,
  ssl: { rejectUnauthorized: false },
});

export async function consulta<T = any>(sql: string, valores: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, valores);
  return r.rows as T[];
}

/** Primeira linha, ou null. Para quando a consulta devolve no máximo uma. */
export async function uma<T = any>(sql: string, valores: unknown[] = []): Promise<T | null> {
  const linhas = await consulta<T>(sql, valores);
  return linhas[0] ?? null;
}

/**
 * O dia corrente em São Paulo. O servidor do banco está em UTC: usar `current_date`
 * lá viraria o dia às 21h daqui. Toda data que vai para o banco sai deste lado.
 */
export function hojeISO(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}
