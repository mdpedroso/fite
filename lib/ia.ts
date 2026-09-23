// IA — quem estima caloria é o backend, com a chave da casa.
//
// A chave fica aqui para não ser entregue a cada navegador, e para quem usa o app não
// precisar saber o que é chave de API: o admin cadastra uma vez e vale para todos.
// Por ora só o Groq; outro serviço entra como mais uma linha em `chave_ia`.
import { consulta, uma } from "./db.js";
import { Recusa } from "./validar.js";

const GROQ = "https://api.groq.com/openai/v1";

// nome de modelo não se confia: a chave diz o que tem, e um teste real diz o que responde.
// Ordem de preferência; o que a chave não tiver é pulado.
const PREF_TEXTO = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "qwen/qwen3.8-27b",
                    "qwen/qwen3.6-27b", "openai/gpt-oss-20b", "llama-3.1-8b-instant",
                    "meta-llama/llama-4-scout-17b-16e-instruct"];
const PREF_FOTO = ["qwen/qwen3.8-27b", "qwen/qwen3.6-27b",
                   "meta-llama/llama-4-scout-17b-16e-instruct",
                   "meta-llama/llama-4-maverick-17b-128e-instruct"];
// 64×64: o Qwen exige pelo menos 32 px por lado
const PNG_TESTE = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwJfTYGYyliH8OITBAtzm7PV1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYB8nOBln5JujwAAAAASUVORK5CYII=";
const SISTEMA = "Responda apenas com um objeto JSON válido, sem texto fora dele.";

export type Imagem = { mime: string; b64: string };
type Conta = {
  chave: string; modelo_texto: string | null; modelo_foto: string | null;
  foto_sem_json: boolean; foto_motivo: string | null;
};
type Descoberta = {
  modelo_texto: string; modelo_foto: string | null; foto_sem_json: boolean; foto_motivo: string | null;
};

const cabecalho = (chave: string) =>
  ({ "content-type": "application/json", Authorization: "Bearer " + chave });

function conteudo(texto: string, imagem?: Imagem | null) {
  return imagem
    ? [{ type: "text", text: texto },
       { type: "image_url", image_url: { url: `data:${imagem.mime};base64,${imagem.b64}` } }]
    : texto;
}

async function motivo(r: Response): Promise<string> {
  const corpo = await r.text().catch(() => "");
  try { return JSON.parse(corpo).error?.message || `HTTP ${r.status}`; } catch { return `HTTP ${r.status}`; }
}

type Teste = { ok: boolean; json?: boolean; status?: number; motivo?: string };

async function testar(chave: string, modelo: string, comImagem: boolean): Promise<Teste> {
  const tentar = async (json: boolean): Promise<Teste> => {
    const body: any = {
      model: modelo, max_tokens: 60,
      messages: [{ role: "user", content: comImagem
        ? conteudo('Descreva a imagem em um JSON: {"desc": "..."}', { mime: "image/png", b64: PNG_TESTE })
        : 'Responda com um JSON: {"ok":true}' }],
    };
    if (json) body.response_format = { type: "json_object" };
    const r = await fetch(`${GROQ}/chat/completions`, {
      method: "POST", headers: cabecalho(chave), body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    return r.ok ? { ok: true, json } : { ok: false, status: r.status, motivo: await motivo(r) };
  };
  try {
    let r = await tentar(true);
    if (!r.ok && comImagem && r.status === 400) r = await tentar(false);   // sem JSON, lemos tolerante
    return r;
  } catch (e: any) {
    return { ok: false, motivo: e?.name === "TimeoutError" ? "sem resposta em 20s" : String(e?.message || e) };
  }
}

/** Lista os modelos da chave e testa até achar um de texto e um de foto que respondam. */
export async function descobrir(chave: string): Promise<Descoberta> {
  const r = await fetch(`${GROQ}/models`, {
    headers: cabecalho(chave), signal: AbortSignal.timeout(15_000),
  }).catch(() => { throw new Recusa("o Groq não respondeu em 15s"); });
  if (r.status === 401) throw new Recusa("o Groq recusou a chave; confira se copiou inteira");
  if (!r.ok) throw new Recusa(`o Groq respondeu ${r.status}`);
  const ids: string[] = ((await r.json()).data || []).map((m: any) => String(m.id))
    .filter((id: string) => !/whisper|guard|tts|orpheus|safeguard|compound|allam|embed/i.test(id));
  if (!ids.length) throw new Recusa("a chave não lista nenhum modelo de texto");

  let modelo_texto: string | null = null, ultimo = "";
  for (const m of [...new Set([...PREF_TEXTO.filter(p => ids.includes(p)), ...ids])].slice(0, 8)) {
    const t = await testar(chave, m, false);
    if (t.ok) { modelo_texto = m; break; }
    ultimo = t.motivo || ultimo;
  }
  if (!modelo_texto) throw new Recusa("nenhum modelo de texto respondeu" + (ultimo ? ": " + ultimo.slice(0, 80) : ""));

  let modelo_foto: string | null = null, foto_sem_json = false, foto_motivo: string | null = null;
  const candFoto = PREF_FOTO.filter(v => ids.includes(v));
  if (!candFoto.length) foto_motivo = "a chave não lista modelo de visão";
  for (const m of candFoto) {
    const t = await testar(chave, m, true);
    if (t.ok) { modelo_foto = m; foto_sem_json = !t.json; foto_motivo = null; break; }
    foto_motivo = `${m.replace(/^.*\//, "")}: ${t.motivo}`;
  }
  return { modelo_texto, modelo_foto, foto_sem_json, foto_motivo };
}

const contaGroq = () =>
  uma<Conta>(`select chave, modelo_texto, modelo_foto, foto_sem_json, foto_motivo
                from chave_ia where servico = 'groq'`);

async function guardarDescoberta(d: Descoberta) {
  await consulta(
    `update chave_ia set modelo_texto = $1, modelo_foto = $2, foto_sem_json = $3,
                         foto_motivo = $4, testado_em = now()
      where servico = 'groq'`,
    [d.modelo_texto, d.modelo_foto, d.foto_sem_json, d.foto_motivo]);
}

/** Testa a chave antes de guardar: chave errada tem que falhar agora, não na primeira refeição. */
export async function cadastrarGroq(chave: string, admin: string) {
  const d = await descobrir(chave);
  await consulta(
    `insert into chave_ia (servico, chave, modelo_texto, modelo_foto, foto_sem_json,
                           foto_motivo, testado_em, atualizado_por)
     values ('groq', $1, $2, $3, $4, $5, now(), $6)
     on conflict (servico) do update set
       chave = excluded.chave, modelo_texto = excluded.modelo_texto,
       modelo_foto = excluded.modelo_foto, foto_sem_json = excluded.foto_sem_json,
       foto_motivo = excluded.foto_motivo, testado_em = now(),
       atualizado_por = excluded.atualizado_por`,
    [chave, d.modelo_texto, d.modelo_foto, d.foto_sem_json, d.foto_motivo, admin]);
  return situacao();
}

/** O que a aba de admin mostra. A chave em si nunca volta ao navegador, só o final dela. */
export async function situacao() {
  const c = await uma<Conta & { testado_em: string | null; atualizado_em: string; por: string | null }>(
    `select k.chave, k.modelo_texto, k.modelo_foto, k.foto_sem_json, k.foto_motivo,
            k.testado_em, k.atualizado_em, u.email as por
       from chave_ia k left join usuario u on u.id = k.atualizado_por
      where k.servico = 'groq'`);
  if (!c) return { groq: null };
  return { groq: {
    final: c.chave.slice(-4), modelo_texto: c.modelo_texto, modelo_foto: c.modelo_foto,
    foto_motivo: c.foto_motivo, testado_em: c.testado_em, atualizado_em: c.atualizado_em, por: c.por,
  } };
}

// o modo JSON já impede texto fora do objeto; isto é rede de segurança
function lerJSON(txt: string): unknown {
  try { return JSON.parse(txt); } catch { /* procura o objeto dentro do texto */ }
  const m = txt.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* cai na recusa */ } }
  throw new Recusa("a IA respondeu sem JSON legível; descreva de outro jeito");
}

// na hora de estimar, qualquer falha ao descobrir modelo é problema da casa, não do pedido:
// o app espera e tenta de novo em vez de desistir da refeição
const redescobrir = (chave: string) => descobrir(chave).catch(e => {
  throw e instanceof Recusa ? new Recusa(e.message, 503) : e;
});

/** Pergunta ao modelo e devolve o JSON que ele respondeu, com o nome de quem respondeu. */
export async function estimar(prompt: string, imagem: Imagem | null, jaRedescobriu = false): Promise<{ r: unknown; modelo: string }> {
  let c = await contaGroq();
  if (!c) throw new Recusa("a IA ainda não foi configurada; peça ao admin", 503);
  if (!c.modelo_texto) {
    await guardarDescoberta(await redescobrir(c.chave));
    c = await contaGroq();
    if (!c?.modelo_texto) throw new Recusa("o Groq está sem modelo de texto", 503);
  }
  if (imagem && !c.modelo_foto)
    throw new Recusa("a IA não lê foto agora" + (c.foto_motivo ? ": " + c.foto_motivo.slice(0, 90) : ""), 503);

  const modelo = (imagem ? c.modelo_foto : c.modelo_texto) as string;
  const r = await fetch(`${GROQ}/chat/completions`, {
    method: "POST", headers: cabecalho(c.chave),
    body: JSON.stringify({
      model: modelo, temperature: 0.2,
      ...(imagem && c.foto_sem_json ? {} : { response_format: { type: "json_object" } }),
      messages: [{ role: "system", content: SISTEMA }, { role: "user", content: conteudo(prompt, imagem) }],
    }),
    signal: AbortSignal.timeout(40_000),
  }).catch(() => { throw new Recusa("o Groq não respondeu a tempo", 503); });

  if (!r.ok) {
    const msg = await motivo(r);
    if (r.status === 404 && !jaRedescobriu) {      // o modelo saiu do ar: redescobre uma vez
      await guardarDescoberta(await redescobrir(c.chave));
      return estimar(prompt, imagem, true);
    }
    console.error("groq", r.status, msg);
    if (r.status === 401) throw new Recusa("a chave do Groq foi recusada; peça ao admin para trocar", 503);
    if (r.status === 429) throw new Recusa("Groq no limite de requisições; tenta de novo sozinho", 503);
    if (r.status >= 500) throw new Recusa("Groq instável agora; tenta de novo sozinho", 503);
    throw new Recusa(`Groq recusou (${r.status}): ${msg.slice(0, 100)}`);
  }
  const txt = (await r.json())?.choices?.[0]?.message?.content;
  if (!txt) throw new Recusa("o Groq respondeu vazio; tenta de novo sozinho", 503);
  // `llm` guarda o modelo, não o provedor: é o que permite comparar estimativas depois
  return { r: lerJSON(String(txt)), modelo: "groq/" + modelo.replace(/^.*\//, "") };
}
