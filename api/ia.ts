// /api/ia — POST estima: recebe o pedido montado pela tela e devolve o JSON do modelo.
//
// A tela continua dona do prompt (é ela que sabe o formato da refeição e do treino); o
// servidor só guarda a chave e fala com o modelo.
import { rota, corpoJson } from "../lib/rota.js";
import { estimar, type Imagem } from "../lib/ia.js";
import { texto, Recusa } from "../lib/validar.js";

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

export default rota({
  POST: async (req) => {
    const c = corpoJson(req);
    const { r, modelo } = await estimar(texto(c.prompt, "prompt", 20_000), imagem(c.imagem));
    return { r, motor: modelo };
  },
});
