// /api/foto — POST guarda (devolve o caminho para `foto_url`), GET ?p=<caminho> devolve a imagem.
import { rota, q, corpoJson } from "../lib/rota.js";
import { guardarFoto, lerFoto } from "../lib/fotos.js";
import { texto } from "../lib/validar.js";

export default rota({
  POST: async (req, _res, quem) =>
    ({ foto_url: await guardarFoto(quem.id, texto(corpoJson(req).b64, "foto", 3_000_000)) }),

  GET: async (req, res, quem) => {
    const bytes = await lerFoto(quem.id, q(req, "p"));
    // o caminho tem uuid e a foto nunca muda: o aparelho pode guardar à vontade
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.status(200).send(bytes);
  },
});
