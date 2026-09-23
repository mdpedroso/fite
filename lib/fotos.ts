// Fotos de refeição e treino, no bucket privado `fotos` do Supabase Storage.
//
// O navegador nunca fala com o Storage: sobe e baixa por aqui, que confere de quem é a
// foto. O caminho começa pelo id do usuário, e só o dono lê o que está debaixo dele.
import { randomUUID } from "node:crypto";
import { Recusa } from "./validar.js";

const BUCKET = "fotos";
// a foto já sai do aparelho em 1024 px (~200 KB); isto só barra o absurdo
export const MAX_B64 = 3_000_000;
const CAMINHO = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/;

function storage(caminho: string) {
  const url = process.env.SUPABASE_URL, chave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !chave) {
    console.error("storage: variável faltando", { SUPABASE_URL: !!url, SUPABASE_SECRET_KEY: !!chave });
    throw new Recusa("o armazenamento de fotos não está configurado", 503);
  }
  // chave nova (sb_secret_) vai só no apikey; a antiga (service_role) é JWT e vai nos dois
  // chave com quebra de linha ou espaço (colada em duas linhas) quebra o cabeçalho, e a
  // mensagem de erro do fetch traria a chave inteira: barra antes, sem nunca logar o valor
  if (/\s/.test(chave)) {
    console.error("storage: SUPABASE_SECRET_KEY tem espaço ou quebra de linha");
    throw new Recusa("o armazenamento de fotos está mal configurado", 503);
  }
  const cab: Record<string, string> = { apikey: chave };
  if (!chave.startsWith("sb_")) cab.Authorization = "Bearer " + chave;
  return { url: `${url.replace(/\/$/, "")}/storage/v1/object/${BUCKET}/${caminho}`, cab };
}

/** Guarda a foto e devolve o caminho, que vai para `foto_url`. */
export async function guardarFoto(usuario: string, b64: string): Promise<string> {
  if (!b64 || b64.length > MAX_B64) throw new Recusa("foto vazia ou grande demais");
  const caminho = `${usuario}/${randomUUID()}.jpg`;
  const { url, cab } = storage(caminho);
  const r = await fetch(url, {
    method: "POST", headers: { ...cab, "content-type": "image/jpeg" },
    body: Buffer.from(b64, "base64"), signal: AbortSignal.timeout(20_000),
  }).catch(e => {
    console.error("storage upload falhou", new URL(url).host, (e as Error)?.name ?? "erro");
    throw new Recusa("o armazenamento não respondeu", 503);
  });
  if (!r.ok) {
    console.error("storage upload", r.status, await r.text().catch(() => ""));
    throw new Recusa("não consegui guardar a foto", 503);
  }
  return caminho;
}

/** Os bytes da foto, só se ela for de quem pede. */
export async function lerFoto(usuario: string, caminho: string): Promise<Buffer> {
  if (!CAMINHO.test(caminho) || !caminho.startsWith(usuario + "/"))
    throw new Recusa("foto não encontrada", 404);
  const { url, cab } = storage(caminho);
  const r = await fetch(url, { headers: cab, signal: AbortSignal.timeout(20_000) })
    .catch(e => {
      // o host diz se SUPABASE_URL está certo; só o tipo do erro vai para o log: a
      // mensagem do fetch pode conter os cabeçalhos, e com eles a chave
      console.error("storage download falhou", new URL(url).host, (e as Error)?.name ?? "erro");
      throw new Recusa("o armazenamento não respondeu", 503);
    });
  if (r.status === 400 || r.status === 404) throw new Recusa("foto não encontrada", 404);
  if (!r.ok) {
    console.error("storage download", r.status, await r.text().catch(() => ""));
    throw new Recusa("não consegui ler a foto", 503);
  }
  return Buffer.from(await r.arrayBuffer());
}
