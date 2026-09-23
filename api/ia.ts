// /api/ia — POST estima: recebe o pedido montado pela tela e devolve o JSON do modelo.
// GET e PUT são do admin: veem a situação e trocam a chave do Groq.
//
// A tela continua dona do prompt (é ela que sabe o formato da refeição e do treino); o
// servidor só guarda a chave e fala com o modelo. Chave e estimativa moram na mesma rota
// porque o plano gratuito do Vercel aceita 12 funções, e cada arquivo em api/ é uma.
import { rota, corpoJson } from "../lib/rota.js";
import { estimar, situacao, cadastrarGroq, type Imagem } from "../lib/ia.js";
import { texto, Recusa } from "../lib/validar.js";
import type { Quem } from "../lib/sessao.js";

// a foto já sai do aparelho reduzida a 1024 px (~200 KB); isto só barra o absurdo
const MAX_FOTO = 3_000_000;

function imagem(v: unknown): Imagem | null {
  if (v === null || v === undefined) return null;
  const i = v as Record<string, unknown>;
  if (typeof i.mime !== "string" || !/^image\/(jpeg|png|webp|gif)$/.test(i.mime))
    throw new Recusa("foto em formato que a IA não lê");
  if (typeof i.b64 !== "string" || !i.b64) throw new Recusa("foto vazia");
  if (i.b64.length > MAX_FOTO) throw new Recusa("foto grande demais");
  return { mime: i.mime, b64: i.b64 };
}

// A permissão sai da tabela `admin`, conferida aqui: esconder a aba na tela é conforto,
// não segurança.
function exigirAdmin(quem: Quem) {
  if (!quem.admin) throw new Recusa("só o admin mexe nas chaves de IA", 403);
}

export default rota({
  POST: async (req) => {
    const c = corpoJson(req);
    const { r, modelo } = await estimar(texto(c.prompt, "prompt", 20_000), imagem(c.imagem));
    return { r, motor: modelo };
  },
  GET: async (_req, _res, quem) => { exigirAdmin(quem); return situacao(); },
  PUT: async (req, _res, quem) => {
    exigirAdmin(quem);
    return cadastrarGroq(texto(corpoJson(req).chave, "chave", 300), quem.id);
  },
});
