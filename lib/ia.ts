// IA — quem estima caloria é o backend, com a chave da casa.
//
// A chave fica aqui para não ser entregue a cada navegador, e para quem usa o app não
// precisar saber o que é chave de API: o admin cadastra uma vez e vale para todos.
// Cada serviço é uma linha em `chave_ia`. Os dois falam o formato do OpenAI
// (chat/completions, models), então o código é o mesmo e só muda o endereço.
import { consulta, uma } from "./db.js";
import { Recusa } from "./validar.js";

type Servico = {
  nome: string; base: string;
  // nome de modelo não se confia: a chave diz o que tem, e um teste real diz o que responde.
  // Ordem de preferência; o que a chave não tiver é pulado.
  prefTexto: string[]; prefFoto: string[];
  fora: RegExp;                    // o que o /models lista mas não é modelo de conversa
  extra?: (modelo: string) => Record<string, unknown>; // parâmetros próprios, testados junto
  cabecalhos?: Record<string, string>;
  // onde conferir a chave antes de testar modelos, quando o /models é público e não a confere
  conferir?: string;
};
export const SERVICOS: Record<string, Servico> = {
  groq: {
    nome: "Groq", base: "https://api.groq.com/openai/v1",
    prefTexto: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "qwen/qwen3.8-27b",
                "qwen/qwen3.6-27b", "openai/gpt-oss-20b", "llama-3.1-8b-instant",
                "meta-llama/llama-4-scout-17b-16e-instruct"],
    prefFoto: ["qwen/qwen3.8-27b", "qwen/qwen3.6-27b",
               "meta-llama/llama-4-scout-17b-16e-instruct",
               "meta-llama/llama-4-maverick-17b-128e-instruct"],
    fora: /whisper|guard|tts|orpheus|safeguard|compound|allam|embed/i,
  },
  // Entrou em 23/09, quando o Groq bateu no limite e o plano pago dele estava fechado.
  gemini: {
    nome: "Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai",
    prefTexto: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash",
                "gemini-flash-latest", "gemini-2.5-flash", "gemini-3.5-flash-lite"],
    // todo Gemini de conversa lê imagem
    prefFoto: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash",
               "gemini-flash-latest", "gemini-2.5-flash", "gemini-3.5-flash-lite"],
    fora: /tts|live|image|imagen|veo|embed|audio|transcri|translate|robotics|aqa|gemma|computer|omni|pro/i,
    // pensar demais só atrasa uma conta de caloria; "low" vale do 2.5 ao 3.x
    extra: () => ({ reasoning_effort: "low" }),
  },
  // Entrou em 23/09: um lugar só, crédito pré-pago no cartão, e o Gemini, o GPT e o Qwen
  // atrás da mesma chave. O /models lista o catálogo inteiro (não o da chave), então a
  // preferência pesa mais aqui; o teste real continua valendo.
  openrouter: {
    nome: "OpenRouter", base: "https://openrouter.ai/api/v1",
    // Texto vai no lite: "quantas calorias tem uma banana" não pede modelo grande, e ele
    // custa um sétimo do 3.8. Foto vai no 3.8, onde reconhecer o prato e a porção pesa.
    prefTexto: ["google/gemini-2.5-flash-lite", "google/gemini-3.1-flash-lite",
                "google/gemini-3.8-flash", "openai/gpt-5.4-mini"],
    prefFoto: ["google/gemini-3.8-flash", "google/gemini-3.5-flash", "openai/gpt-5.4-mini",
               "google/gemini-2.5-flash"],
    // :batch não responde na hora e :free tem limite baixo e some sem aviso
    fora: /:batch|:free|image|audio|tts|embed|guard|safety/i,
    // os lite não pensam por padrão, e pedir esforço ligaria o raciocínio; nos outros o
    // padrão é pensar muito, o que só atrasa uma conta de caloria
    extra: m => /lite/.test(m) ? {} : { reasoning: { effort: "low" } },
    cabecalhos: { "HTTP-Referer": "https://www.fite.app.br", "X-Title": "FiTe" },
    conferir: "/key",
  },
};
const servico = (s: string) => {
  const v = SERVICOS[s];
  if (!v) throw new Recusa("serviço de IA desconhecido");
  return v;
};

// 64×64: o Qwen exige pelo menos 32 px por lado
const PNG_TESTE = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwJfTYGYyliH8OITBAtzm7PV1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYB8nOBln5JujwAAAAASUVORK5CYII=";
const SISTEMA = "Responda apenas com um objeto JSON válido, sem texto fora dele.";

export type Imagem = { mime: string; b64: string };
type Conta = {
  servico: string; chave: string; modelo_texto: string | null; modelo_foto: string | null;
  foto_sem_json: boolean; foto_motivo: string | null;
};
type Descoberta = {
  modelo_texto: string; modelo_foto: string | null; foto_sem_json: boolean; foto_motivo: string | null;
};

const cabecalho = (chave: string, sv?: Servico) =>
  ({ "content-type": "application/json", Authorization: "Bearer " + chave, ...sv?.cabecalhos });

function conteudo(texto: string, imagem?: Imagem | null) {
  return imagem
    ? [{ type: "text", text: texto },
       { type: "image_url", image_url: { url: `data:${imagem.mime};base64,${imagem.b64}` } }]
    : texto;
}

async function motivo(r: Response): Promise<string> {
  const corpo = await r.text().catch(() => "");
  try {
    const j = JSON.parse(corpo);
    return (Array.isArray(j) ? j[0] : j).error?.message || `HTTP ${r.status}`;   // o Google às vezes devolve lista
  } catch { return `HTTP ${r.status}`; }
}

type Teste = { ok: boolean; json?: boolean; status?: number; motivo?: string };

async function testar(sv: Servico, chave: string, modelo: string, comImagem: boolean): Promise<Teste> {
  const tentar = async (json: boolean): Promise<Teste> => {
    const body: any = {
      model: modelo, max_tokens: 1500, ...sv.extra?.(modelo),   // folga para o raciocínio
      messages: [{ role: "user", content: comImagem
        ? conteudo('Descreva a imagem em um JSON: {"desc": "..."}', { mime: "image/png", b64: PNG_TESTE })
        : 'Responda com um JSON: {"ok":true}' }],
    };
    if (json) body.response_format = { type: "json_object" };
    const r = await fetch(`${sv.base}/chat/completions`, {
      method: "POST", headers: cabecalho(chave, sv), body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    return r.ok ? { ok: true, json } : { ok: false, status: r.status, motivo: await motivo(r) };
  };
  try {
    let r = await tentar(true);
    if (!r.ok && r.status === 400) r = await tentar(false);   // sem JSON, lemos tolerante
    return r;
  } catch (e: any) {
    return { ok: false, motivo: e?.name === "TimeoutError" ? "sem resposta em 20s" : String(e?.message || e) };
  }
}

/** Lista os modelos da chave e testa até achar um de texto e um de foto que respondam. */
export async function descobrir(s: string, chave: string): Promise<Descoberta> {
  const sv = servico(s);
  if (sv.conferir) {
    const k = await fetch(sv.base + sv.conferir, {
      headers: cabecalho(chave, sv), signal: AbortSignal.timeout(15_000),
    }).catch(() => { throw new Recusa(`o ${sv.nome} não respondeu em 15s`); });
    if (k.status === 401 || k.status === 403) throw new Recusa(`o ${sv.nome} recusou a chave; confira se copiou inteira`);
  }
  const r = await fetch(`${sv.base}/models`, {
    headers: cabecalho(chave, sv), signal: AbortSignal.timeout(15_000),
  }).catch(() => { throw new Recusa(`o ${sv.nome} não respondeu em 15s`); });
  if (r.status === 401 || r.status === 403 || r.status === 400)
    throw new Recusa(`o ${sv.nome} recusou a chave; confira se copiou inteira`);
  if (!r.ok) throw new Recusa(`o ${sv.nome} respondeu ${r.status}`);
  // o Google lista como "models/gemini-…"; o chat quer só o nome
  const ids: string[] = ((await r.json()).data || []).map((m: any) => String(m.id).replace(/^models\//, ""))
    .filter((id: string) => !sv.fora.test(id));
  if (!ids.length) throw new Recusa("a chave não lista nenhum modelo de texto");

  let modelo_texto: string | null = null, ultimo = "";
  for (const m of [...new Set([...sv.prefTexto.filter(p => ids.includes(p)), ...ids])].slice(0, 8)) {
    const t = await testar(sv, chave, m, false);
    if (t.ok) { modelo_texto = m; break; }
    ultimo = t.motivo || ultimo;
  }
  if (!modelo_texto) throw new Recusa("nenhum modelo de texto respondeu" + (ultimo ? ": " + ultimo.slice(0, 80) : ""));

  let modelo_foto: string | null = null, foto_sem_json = false, foto_motivo: string | null = null;
  const candFoto = sv.prefFoto.filter(v => ids.includes(v));
  if (!candFoto.length) foto_motivo = "a chave não lista modelo de visão";
  for (const m of candFoto) {
    const t = await testar(sv, chave, m, true);
    if (t.ok) { modelo_foto = m; foto_sem_json = !t.json; foto_motivo = null; break; }
    foto_motivo = `${m.replace(/^.*\//, "")}: ${t.motivo}`;
  }
  return { modelo_texto, modelo_foto, foto_sem_json, foto_motivo };
}

// A chave salva por último é a que estima; a outra fica de reserva para quando a primeira
// bater no limite ou cair.
const contas = () =>
  consulta<Conta>(`select servico, chave, modelo_texto, modelo_foto, foto_sem_json, foto_motivo
                     from chave_ia order by atualizado_em desc`);
const conta = (s: string) =>
  uma<Conta>(`select servico, chave, modelo_texto, modelo_foto, foto_sem_json, foto_motivo
                from chave_ia where servico = $1`, [s]);

async function guardarDescoberta(s: string, d: Descoberta) {
  await consulta(
    `update chave_ia set modelo_texto = $1, modelo_foto = $2, foto_sem_json = $3,
                         foto_motivo = $4, testado_em = now()
      where servico = $5`,
    [d.modelo_texto, d.modelo_foto, d.foto_sem_json, d.foto_motivo, s]);
}

/** Testa a chave antes de guardar: chave errada tem que falhar agora, não na primeira refeição. */
export async function cadastrar(s: string, chave: string, admin: string) {
  const d = await descobrir(s, chave);
  await consulta(
    `insert into chave_ia (servico, chave, modelo_texto, modelo_foto, foto_sem_json,
                           foto_motivo, testado_em, atualizado_por)
     values ($7, $1, $2, $3, $4, $5, now(), $6)
     on conflict (servico) do update set
       chave = excluded.chave, modelo_texto = excluded.modelo_texto,
       modelo_foto = excluded.modelo_foto, foto_sem_json = excluded.foto_sem_json,
       foto_motivo = excluded.foto_motivo, testado_em = now(),
       atualizado_por = excluded.atualizado_por`,
    [chave, d.modelo_texto, d.modelo_foto, d.foto_sem_json, d.foto_motivo, admin, s]);
  return situacao();
}

/** O que a aba de admin mostra. A chave em si nunca volta ao navegador, só o final dela. */
export async function situacao() {
  const linhas = (await consulta<Conta & { testado_em: string | null; atualizado_em: string; por: string | null }>(
    `select k.servico, k.chave, k.modelo_texto, k.modelo_foto, k.foto_sem_json, k.foto_motivo,
            k.testado_em, k.atualizado_em, u.email as por
       from chave_ia k left join usuario u on u.id = k.atualizado_por
      order by k.atualizado_em desc`));
  const r: Record<string, unknown> = {};
  for (const s of Object.keys(SERVICOS)) r[s] = null;
  linhas.forEach((c, i) => {
    if (!(c.servico in SERVICOS)) return;
    r[c.servico] = {
      final: c.chave.slice(-4), modelo_texto: c.modelo_texto, modelo_foto: c.modelo_foto,
      foto_motivo: c.foto_motivo, testado_em: c.testado_em, atualizado_em: c.atualizado_em, por: c.por,
      em_uso: i === 0,
    };
  });
  return r;
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
const redescobrir = (s: string, chave: string) => descobrir(s, chave).catch(e => {
  throw e instanceof Recusa ? new Recusa(e.message, 503) : e;
});

/** Pergunta ao modelo e devolve o JSON que ele respondeu, com o nome de quem respondeu.
 *  Se o serviço principal estiver no limite, fora do ar ou com a chave recusada, tenta o
 *  outro: a refeição não fica esperando por causa de um só provedor. */
export async function estimar(prompt: string, imagem: Imagem | null): Promise<{ r: unknown; modelo: string }> {
  const cs = (await contas()).filter(c => c.servico in SERVICOS);
  if (!cs.length) throw new Recusa("a IA ainda não foi configurada; peça ao admin", 503);
  let erro: unknown;
  for (const c of cs) {
    try { return await estimarCom(c, prompt, imagem); }
    catch (e) {
      // 503 aqui é "problema da casa"; erro do pedido (4xx) não melhora trocando de serviço
      if (!(e instanceof Recusa) || e.status !== 503) throw e;
      erro = erro ?? e;
    }
  }
  throw erro;
}

async function estimarCom(c0: Conta, prompt: string, imagem: Imagem | null, jaRedescobriu = false, semJson = false): Promise<{ r: unknown; modelo: string }> {
  const s = c0.servico, sv = servico(s);
  let c: Conta | null = c0;
  if (!c.modelo_texto) {
    await guardarDescoberta(s, await redescobrir(s, c.chave));
    c = await conta(s);
    if (!c?.modelo_texto) throw new Recusa(`o ${sv.nome} está sem modelo de texto`, 503);
  }
  if (imagem && !c.modelo_foto)
    throw new Recusa("a IA não lê foto agora" + (c.foto_motivo ? ": " + c.foto_motivo.slice(0, 90) : ""), 503);

  const modelo = (imagem ? c.modelo_foto : c.modelo_texto) as string;
  const r = await fetch(`${sv.base}/chat/completions`, {
    method: "POST", headers: cabecalho(c.chave, sv),
    body: JSON.stringify({
      model: modelo, temperature: 0.2, ...sv.extra?.(modelo),
      ...(semJson || (imagem && c.foto_sem_json) ? {} : { response_format: { type: "json_object" } }),
      messages: [{ role: "system", content: SISTEMA }, { role: "user", content: conteudo(prompt, imagem) }],
    }),
    signal: AbortSignal.timeout(40_000),
  }).catch(() => { throw new Recusa(`o ${sv.nome} não respondeu a tempo`, 503); });

  if (!r.ok) {
    const msg = await motivo(r);
    if (r.status === 404 && !jaRedescobriu) {      // o modelo saiu do ar: redescobre uma vez
      await guardarDescoberta(s, await redescobrir(s, c.chave));
      const novo = await conta(s);
      if (novo) return estimarCom(novo, prompt, imagem, true, semJson);
    }
    // o modelo de texto recusou o modo JSON (o teste ao salvar passou sem ele): lemos tolerante
    if (r.status === 400 && !semJson && /json|response_format|mime/i.test(msg))
      return estimarCom(c, prompt, imagem, jaRedescobriu, true);
    console.error(s, r.status, msg);
    if (r.status === 401 || r.status === 403) throw new Recusa(`a chave do ${sv.nome} foi recusada; peça ao admin para trocar`, 503);
    if (r.status === 402) throw new Recusa(`${sv.nome} sem crédito; peça ao admin para recarregar`, 503);
    if (r.status === 429) throw new Recusa(`${sv.nome} no limite de requisições; tenta de novo sozinho`, 503);
    if (r.status >= 500) throw new Recusa(`${sv.nome} instável agora; tenta de novo sozinho`, 503);
    throw new Recusa(`${sv.nome} recusou (${r.status}): ${msg.slice(0, 100)}`);
  }
  const txt = (await r.json())?.choices?.[0]?.message?.content;
  if (!txt) throw new Recusa(`o ${sv.nome} respondeu vazio; tenta de novo sozinho`, 503);
  // `llm` guarda o modelo, não o provedor: é o que permite comparar estimativas depois
  return { r: lerJSON(String(txt)), modelo: `${s}/` + modelo.replace(/^.*\//, "") };
}

// Áudio → texto. Em 23/09, com a lista de palavras abaixo, o whisper-large-v3 acertou
// "whey" e "bolonhesa" (os erros que apareceram no uso) e o turbo não; custa ~0,2 s a mais
// por fala (0,5 s contra 0,35 s numa frase de 10 s). O reconhecimento de voz do navegador
// ficava bem abaixo disso, e varia de aparelho para aparelho.
const TRANSCRICAO = "whisper-large-v3";
// O Whisper puxa a grafia do que aparece no prompt: sem isto, "whey" virava "ei" e
// "bolonhesa" virava "bolognese". Palavra que ele errar no uso entra aqui.
const VOCABULARIO = "Refeição ou treino, em português do Brasil. Palavras comuns: whey, scoop, " +
  "shake, bolonhesa, strogonoff, parmesão, tapioca, açaí, cuscuz, farofa, requeijão, iogurte, " +
  "granola, pão francês, feijão preto, crossfit, WOD, burpee.";
// o Groq descobre o formato pela extensão do nome do arquivo
const EXTENSAO: Record<string, string> = {
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
  "audio/aac": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav",
};
export const MAX_AUDIO_B64 = 3_500_000;   // o Vercel recusa corpo acima de 4,5 MB

// Pelo OpenRouter, a voz vai no mesmo Gemini lite do texto. Ele não aceita webm (o que o
// Chrome do Android grava por padrão), então o app pede AAC ao gravar; o que chegar em
// webm, ou falhar lá, cai no Whisper do Groq.
const TRANSCRICAO_OR = ["google/gemini-2.5-flash-lite", "google/gemini-3.1-flash-lite"];
const FORMATO_OR: Record<string, string> = { m4a: "m4a", ogg: "ogg", mp3: "mp3", wav: "wav" };

async function transcreverOpenRouter(chave: string, formato: string, b64: string): Promise<string> {
  const sv = SERVICOS.openrouter!;
  let ultimo = "";
  for (const modelo of TRANSCRICAO_OR) {
    const r = await fetch(`${sv.base}/chat/completions`, {
      method: "POST", headers: cabecalho(chave, sv), signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: modelo, temperature: 0,
        messages: [{ role: "user", content: [
          { type: "text", text: "Transcreva exatamente o que foi dito, sem comentar nem resumir. " +
            "Responda só com o texto falado; se não houver fala, responda vazio. " + VOCABULARIO },
          { type: "input_audio", input_audio: { data: b64, format: formato } },
        ] }],
      }),
    }).catch(() => { throw new Recusa("o OpenRouter não respondeu a tempo", 503); });
    if (r.ok) return String((await r.json())?.choices?.[0]?.message?.content ?? "").trim();
    ultimo = `${r.status} ${await motivo(r)}`;
    if (r.status !== 404 && r.status !== 400) break;   // modelo fora do ar ou formato: tenta o próximo
  }
  console.error("openrouter transcrição", ultimo);
  throw new Recusa("não consegui transcrever agora", 503);
}

export async function transcrever(mime: string, b64: string): Promise<string> {
  const ext = EXTENSAO[mime.split(";")[0]!.trim()];
  if (!ext) throw new Recusa("formato de áudio que o app não conhece");
  if (!b64 || b64.length > MAX_AUDIO_B64) throw new Recusa("áudio vazio ou longo demais");
  const or = FORMATO_OR[ext] ? await conta("openrouter") : null;
  const c = await conta("groq");
  if (or) {
    try { return await transcreverOpenRouter(or.chave, FORMATO_OR[ext]!, b64); }
    catch (e) { if (!c) throw e; }                    // com o Groq de reserva, tenta ele
  }
  if (!c) throw new Recusa(ext === "webm"
    ? "este aparelho grava num formato que só o Groq transcreve; digite a refeição"
    : "a voz precisa de uma chave do OpenRouter ou do Groq; digite a refeição", 503);

  const form = new FormData();
  form.append("file", new Blob([Buffer.from(b64, "base64")], { type: mime }), `fala.${ext}`);
  form.append("model", TRANSCRICAO);
  form.append("language", "pt");
  form.append("temperature", "0");
  form.append("response_format", "json");
  form.append("prompt", VOCABULARIO);

  const r = await fetch(`${SERVICOS.groq!.base}/audio/transcriptions`, {
    method: "POST", headers: { Authorization: "Bearer " + c.chave }, body: form,
    signal: AbortSignal.timeout(30_000),
  }).catch(() => { throw new Recusa("o Groq não respondeu a tempo", 503); });
  if (!r.ok) {
    const msg = await motivo(r);
    console.error("groq transcrição", r.status, msg);
    if (r.status === 429) throw new Recusa("Groq no limite de requisições; tente de novo", 503);
    if (r.status >= 500 || r.status === 401) throw new Recusa("não consegui transcrever agora", 503);
    throw new Recusa(`o Groq recusou o áudio (${r.status})`);
  }
  return String((await r.json())?.text ?? "").trim();
}
