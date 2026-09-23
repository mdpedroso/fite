// Testes da camada que leva o diário ao servidor — as funções são extraídas do próprio
// index.html, porque testar uma cópia não provaria nada sobre o que está no ar.
//
// O que estes testes protegem: nenhum lançamento pode sumir. Nem o feito sem rede, nem o
// que estava aqui quando o servidor respondeu, nem o que outro aparelho apagou por engano.
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ini = html.indexOf("/* ==================== o diário no servidor ==================== */");
const fim = html.indexOf("/* ==================== intervals.icu ==================== */");
if (ini < 0 || fim < 0) { console.error("não achei a camada de dados no index.html"); process.exit(1); }
const CAMADA = html.slice(ini, fim);

/* ---------- o servidor de mentira ---------- */
// Responde como as rotas respondem, inclusive o 400 de "não encontrada" — é dele que sai
// o caso mais delicado, o da linha apagada em outro aparelho.
function criarServidor() {
  const banco = { refeicao: new Map(), treino: new Map(), medicao: new Map(), dia: new Set(), perfil: null };
  let seq = 0, fora = false, chamadas = [];

  const erro = (msg, status) => {
    const e = new Error(msg); e.status = status;
    e.permanente = status >= 400 && status < 500;
    throw e;
  };

  async function api(caminho, opt = {}) {
    if (fora) { const e = new Error("rede fora"); e.status = 0; e.permanente = false; throw e; }
    const metodo = (opt.method || "GET").toUpperCase();
    const [rota, query] = caminho.split("?");
    const par = new URLSearchParams(query || "");
    const corpo = opt.body ? JSON.parse(opt.body) : {};
    chamadas.push(`${metodo} ${rota}`);

    if (rota === "refeicao" || rota === "treino") {
      const tabela = banco[rota];
      if (metodo === "POST") {
        const id = `${rota}-${++seq}`;
        tabela.set(id, { id, ...corpo });
        return { id, ...corpo };
      }
      if (metodo === "PATCH") {
        const linha = tabela.get(corpo.id);
        if (!linha) erro(`${rota} não encontrada`, 400);
        Object.assign(linha, corpo);
        return { id: linha.id };
      }
      if (metodo === "DELETE") {
        const id = par.get("id");
        if (!tabela.has(id)) erro("não encontrada", 400);
        tabela.delete(id);
        return { id };
      }
    }
    if (rota === "medicao") {
      if (metodo === "PUT") { banco.medicao.set(`${corpo.dia}|${corpo.metrica}`, corpo.valor); return corpo; }
      if (metodo === "DELETE") {
        const chave = `${par.get("dia")}|${par.get("metrica")}`;
        if (!banco.medicao.has(chave)) erro("não encontrada", 400);
        banco.medicao.delete(chave); return { ok: true };
      }
    }
    if (rota === "dia") {
      if (metodo === "POST") { banco.dia.add(corpo.dia); return { ok: true }; }
      if (metodo === "DELETE") { banco.dia.delete(par.get("dia")); return { ok: true }; }
    }
    if (rota === "perfil" && metodo === "PUT") { banco.perfil = corpo; return corpo; }
    if (rota === "foto" && metodo === "POST") {
      const caminho = `u/${++seq}.jpg`; (banco.fotos ||= new Map()).set(caminho, corpo.b64);
      return { foto_url: caminho };
    }
    if (rota.startsWith("diario")) {
      return {
        refeicoes: [...banco.refeicao.values()],
        treinos: [...banco.treino.values()],
        medicoes: [...banco.medicao.entries()].map(([k, valor]) => {
          const [dia, metrica] = k.split("|"); return { dia, metrica, valor };
        }),
        ignorados: [...banco.dia],
        perfil: banco.perfil,
      };
    }
    erro(`rota inesperada: ${metodo} ${rota}`, 404);
  }

  return {
    banco, api,
    apiEnvia: (c, m, corpo) => api(c, { method: m, body: JSON.stringify(corpo) }),
    derrubar: () => { fora = true; },
    levantar: () => { fora = false; },
    chamadas: () => chamadas,
    limparChamadas: () => { chamadas = []; },
  };
}

/* ---------- o aparelho de mentira ---------- */
function criarAparelho(servidor) {
  const ambiente = {
    DIA_MEALS: {}, DIA_WK: {}, WEIGHTS: [], OCULTOS: {},
    PERF: { sexo: "m", nasc: "1982-05-06", altura: 185 },
    TREINOS: { desde: null }, FATOR_ROTINA: 1.4,
    TODAY_ISO: "2026-09-22",
    api: servidor.api, apiEnvia: servidor.apiEnvia,
    diag: () => {}, sincHoje: () => {}, console,
    // a foto de um item, como o IndexedDB guardaria
    fotoDoItem: async m => m.temFoto ? { mime: "image/jpeg", b64: "AAAA" } : null,
    // o cache do aparelho: guarda uma cópia a cada gravação, como o localStorage
    cache: null,
  };
  ambiente.gravarLocal = () => { ambiente.cache = JSON.parse(JSON.stringify(ambiente.DIA_MEALS)); return true; };
  const nomes = Object.keys(ambiente);
  const corpo = `${CAMADA}\n;return {SUJOS, APAGAR, adotarDoServidor, remarcarSujos, enviarPendentes,` +
                ` lerServidor, apagarNoServidor, refeicaoParaApi, treinoParaApi, refeicaoDaApi, treinoDaApi,` +
                ` get WEIGHTS(){ return WEIGHTS; }, set WEIGHTS(v){ WEIGHTS = v; },` +
                ` get OCULTOS(){ return OCULTOS; }, set OCULTOS(v){ OCULTOS = v; }};`;
  // WEIGHTS e OCULTOS são reatribuídos lá dentro; por isso entram por getter, senão o
  // teste ficaria olhando para a lista antiga.
  const fabrica = new Function(...nomes, corpo);
  const app = fabrica(...nomes.map(n => ambiente[n]));
  app.DIA_MEALS = ambiente.DIA_MEALS;
  app.DIA_WK = ambiente.DIA_WK;
  app.PERF = ambiente.PERF;
  app.TREINOS = ambiente.TREINOS;
  app.cache = () => ambiente.cache;
  return app;
}

/* ---------- os testes ---------- */
let falhas = 0, feitos = 0;
function conferir(nome, condicao, detalhe = "") {
  feitos++;
  if (!condicao) { falhas++; console.error(`  ✗ ${nome}${detalhe ? " — " + detalhe : ""}`); }
}
async function teste(nome, corpo) {
  try { await corpo(); } catch (e) { falhas++; console.error(`  ✗ ${nome} explodiu: ${e.stack}`); }
}

const refeicao = (extra = {}) => ({
  id: "local-" + Math.random().toString(36).slice(2, 7),
  desc: "Arroz com feijão", raw: "arroz com feijão",
  kc: 600, p: 20, c: 90, g: 15, ...extra,
});

await teste("lançamento novo sobe uma vez só", async () => {
  const s = criarServidor(), app = criarAparelho(s);
  app.DIA_MEALS["2026-09-22"] = [refeicao()];
  app.SUJOS.add("2026-09-22");
  await app.enviarPendentes();
  conferir("gravou no servidor", s.banco.refeicao.size === 1, `tem ${s.banco.refeicao.size}`);
  conferir("guardou o id do servidor", !!app.DIA_MEALS["2026-09-22"][0].sid);

  s.limparChamadas();
  app.SUJOS.add("2026-09-22");
  await app.enviarPendentes();
  conferir("não reenvia o que não mudou", s.chamadas().length === 0, s.chamadas().join(", "));
});

await teste("edição vira PATCH e exclusão vira DELETE", async () => {
  const s = criarServidor(), app = criarAparelho(s);
  const m = refeicao();
  app.DIA_MEALS["2026-09-22"] = [m];
  app.SUJOS.add("2026-09-22");
  await app.enviarPendentes();

  m.kc = 700; app.SUJOS.add("2026-09-22");
  s.limparChamadas();
  await app.enviarPendentes();
  conferir("editou por PATCH", s.chamadas().join() === "PATCH refeicao", s.chamadas().join());
  conferir("o servidor viu o valor novo", [...s.banco.refeicao.values()][0].kcal === 700);

  app.APAGAR.push({ tabela: "refeicao", sid: m.sid });
  app.DIA_MEALS["2026-09-22"] = [];
  await app.enviarPendentes();
  conferir("apagou no servidor", s.banco.refeicao.size === 0);
  conferir("fila de exclusão esvaziou", app.APAGAR.length === 0);
});

await teste("o que foi lançado sem rede não some quando o servidor responde", async () => {
  const s = criarServidor(), app = criarAparelho(s);
  app.DIA_MEALS["2026-09-22"] = [refeicao({ desc: "Almoço com rede" })];
  app.SUJOS.add("2026-09-22");
  await app.enviarPendentes();

  s.derrubar();
  app.DIA_MEALS["2026-09-22"].push(refeicao({ desc: "Janta sem rede" }));
  app.SUJOS.add("2026-09-22");
  let caiu = false;
  try { await app.enviarPendentes(); } catch (e) { caiu = true; }
  conferir("a gravação sem rede falhou mesmo", caiu);
  conferir("o dia continua sujo", app.SUJOS.has("2026-09-22"));

  s.levantar();
  // o app lê o servidor antes de conseguir enviar: a resposta não tem a janta
  app.adotarDoServidor(await app.lerServidor());
  const descricoes = app.DIA_MEALS["2026-09-22"].map(m => m.desc);
  conferir("a janta sem rede continua na tela", descricoes.includes("Janta sem rede"), descricoes.join(" | "));
  conferir("o dia dela segue sujo", app.SUJOS.has("2026-09-22"));

  await app.enviarPendentes();
  conferir("e chegou ao servidor", s.banco.refeicao.size === 2, `tem ${s.banco.refeicao.size}`);
});

await teste("reabrir pelo cache remarca o que nunca subiu", async () => {
  const s = criarServidor(), app = criarAparelho(s);
  app.DIA_MEALS["2026-09-21"] = [refeicao({ desc: "Lançado offline" })];   // sem sid
  app.DIA_MEALS["2026-09-20"] = [refeicao({ desc: "Já no servidor", sid: "refeicao-99" })];
  app.DIA_MEALS["2026-09-20"][0]._enviado =
    JSON.stringify(app.refeicaoParaApi("2026-09-20", app.DIA_MEALS["2026-09-20"][0]));
  app.SUJOS.clear();

  app.remarcarSujos();
  conferir("o de fora do servidor virou dia sujo", app.SUJOS.has("2026-09-21"));
  conferir("o que já subiu ficou quieto", !app.SUJOS.has("2026-09-20"));
});

await teste("linha apagada em outro aparelho volta em vez de sumir", async () => {
  const s = criarServidor(), app = criarAparelho(s);
  const m = refeicao();
  app.DIA_MEALS["2026-09-22"] = [m];
  app.SUJOS.add("2026-09-22");
  await app.enviarPendentes();

  s.banco.refeicao.clear();          // outro aparelho apagou a linha
  m.kc = 800; app.SUJOS.add("2026-09-22");
  await app.enviarPendentes();
  conferir("a refeição existe de novo", s.banco.refeicao.size === 1);
  conferir("com o valor deste aparelho", [...s.banco.refeicao.values()][0].kcal === 800);
  conferir("e com id novo", m.sid && s.banco.refeicao.has(m.sid));
});

await teste("treino do intervals mantém a origem", async () => {
  const s = criarServidor(), app = criarAparelho(s);
  app.DIA_WK["2026-09-22"] = [{ id: "w1", mod: "corrida", t: "Corrida leve", m: "5,0 km · 30 min",
                                kc: 320, kcMedido: true, icu: "i9876" }];
  app.SUJOS.add("2026-09-22");
  await app.enviarPendentes();
  const linha = [...s.banco.treino.values()][0];
  conferir("fonte é o intervals", linha.fonte === "intervals", String(linha.fonte));
  conferir("external_id foi junto", linha.external_id === "i9876", String(linha.external_id));
  conferir("caloria medida não virou estimativa", linha.kcal_medido === true);
});

await teste("peso, dia ignorado e perfil sobem e voltam", async () => {
  const s = criarServidor(), app = criarAparelho(s);
  app.WEIGHTS = [{ d: "2026-09-22", kg: 84.6 }];
  app.OCULTOS = { "2026-09-21": true };
  app.TREINOS.desde = "2026-09-01";
  await app.enviarPendentes();
  conferir("peso gravado", s.banco.medicao.get("2026-09-22|peso_kg") === 84.6);
  conferir("dia ignorado gravado", s.banco.dia.has("2026-09-21"));
  conferir("perfil gravado", s.banco.perfil?.externo_desde === "2026-09-01");

  app.WEIGHTS = [];
  await app.enviarPendentes();
  conferir("peso apagado some do servidor", !s.banco.medicao.has("2026-09-22|peso_kg"));

  app.adotarDoServidor(await app.lerServidor());
  conferir("dia ignorado voltou", app.OCULTOS["2026-09-21"] === true);
});

await teste("exclusão de item que já não existe lá não trava a fila", async () => {
  const s = criarServidor(), app = criarAparelho(s);
  app.APAGAR.push({ tabela: "refeicao", sid: "refeicao-inexistente" });
  await app.enviarPendentes();
  conferir("a fila esvaziou mesmo assim", app.APAGAR.length === 0);
});

// 22/09: a refeição subiu, o id não foi para o cache, o app recarregou e mandou de novo.
await teste("recarregar depois de enviar não duplica", async () => {
  const s = criarServidor(), app = criarAparelho(s);
  app.DIA_MEALS["2026-09-22"] = [refeicao()];
  app.SUJOS.add("2026-09-22");
  await app.enviarPendentes();
  conferir("o id do servidor foi para o cache", !!app.cache()?.["2026-09-22"]?.[0]?.sid);

  const recarregado = criarAparelho(s);         // abre de novo, pelo cache
  recarregado.DIA_MEALS["2026-09-22"] = JSON.parse(JSON.stringify(app.cache()["2026-09-22"]));
  recarregado.remarcarSujos();
  await recarregado.enviarPendentes();
  conferir("continua uma linha só", s.banco.refeicao.size === 1, `tem ${s.banco.refeicao.size}`);
});

await teste("dois envios ao mesmo tempo mandam a refeição uma vez", async () => {
  const s = criarServidor(), app = criarAparelho(s);
  app.DIA_MEALS["2026-09-22"] = [refeicao()];
  app.SUJOS.add("2026-09-22");
  await Promise.all([app.enviarPendentes(), app.enviarPendentes()]);
  conferir("uma linha só", s.banco.refeicao.size === 1, `tem ${s.banco.refeicao.size}`);
});

await teste("apagar pela tela apaga no servidor", async () => {
  const s = criarServidor(), app = criarAparelho(s);
  const m = refeicao();
  app.DIA_MEALS["2026-09-22"] = [m];
  app.SUJOS.add("2026-09-22");
  await app.enviarPendentes();
  app.apagarNoServidor("refeicao", m); app.DIA_MEALS["2026-09-22"] = [];
  await app.enviarPendentes();
  conferir("sumiu do servidor", s.banco.refeicao.size === 0, `tem ${s.banco.refeicao.size}`);
});

await teste("apagar enquanto a refeição ainda sobe também apaga", async () => {
  const s = criarServidor(), app = criarAparelho(s);
  const m = refeicao();
  app.DIA_MEALS["2026-09-22"] = [m];
  app.SUJOS.add("2026-09-22");
  const subindo = app.enviarPendentes();          // POST em voo
  app.apagarNoServidor("refeicao", m); app.DIA_MEALS["2026-09-22"] = [];
  await subindo;
  await app.enviarPendentes();
  conferir("não sobrou linha", s.banco.refeicao.size === 0, `tem ${s.banco.refeicao.size}`);
});

await teste("foto sobe junto e volta em qualquer aparelho", async () => {
  const s = criarServidor(), app = criarAparelho(s);
  app.DIA_MEALS["2026-09-22"] = [refeicao({ temFoto: true, raw: "", kc: 0, p: 0, c: 0, g: 0, pendente: true })];
  app.SUJOS.add("2026-09-22");
  await app.enviarPendentes();
  const linha = [...s.banco.refeicao.values()][0];
  conferir("a foto foi para o servidor", s.banco.fotos?.size === 1);
  conferir("o lançamento nasceu com foto_url", !!linha.foto_url, String(linha.foto_url));

  const outro = criarAparelho(s);             // outro celular, sem a foto guardada
  outro.adotarDoServidor(await outro.lerServidor());
  const m = outro.DIA_MEALS["2026-09-22"][0];
  conferir("tem foto no outro aparelho", m.temFoto === true && m.foto_url === linha.foto_url);
  conferir("só foto, não estimada: volta pendente", m.pendente === true);

  s.limparChamadas();
  outro.SUJOS.add("2026-09-22");
  await outro.enviarPendentes();
  conferir("não sobe a foto de novo", !s.chamadas().includes("POST foto"), s.chamadas().join());
});

// A marca de pendente não vai para o banco: sem isto, a refeição que a IA ainda não
// estimou voltava do servidor como 0 kcal, sem aviso e fora da fila.
await teste("lançamento não estimado volta do servidor como pendente", async () => {
  const s = criarServidor(), app = criarAparelho(s);
  app.DIA_MEALS["2026-09-22"] = [refeicao({ kc: 0, p: 0, c: 0, g: 0, pendente: true, raw: "1 banana" }),
                                 refeicao({ desc: "Água", raw: "", kc: 0, p: 0, c: 0, g: 0 }),
                                 refeicao({ via: "groq" })];
  app.SUJOS.add("2026-09-22");
  await app.enviarPendentes();
  app.adotarDoServidor(await app.lerServidor());
  const [a, b, c] = app.DIA_MEALS["2026-09-22"];
  conferir("a não estimada está pendente", a.pendente === true);
  conferir("zero digitado sem texto não vira pendente", !b.pendente);
  conferir("a estimada não está pendente", !c.pendente);
});

// Sem Postgres aqui, confere-se o SQL que está no arquivo: o `on conflict` do treino
// importado já limpou `apagado_em`, e o treino apagado voltava na sincronização seguinte.
await teste("treino apagado não ressuscita ao ser importado de novo", async () => {
  const diario = readFileSync(new URL("../lib/diario.ts", import.meta.url), "utf8");
  const ini = diario.indexOf("export async function criarTreino");
  const conflito = diario.slice(diario.indexOf("on conflict", ini), diario.indexOf("returning", ini));
  conferir("achei o on conflict do treino", conflito.includes("do update"));
  conferir("não limpa apagado_em", !/apagado_em\s*=\s*null/.test(conflito), conflito);
  conferir("só atualiza linha viva", /where\s+treino\.apagado_em\s+is\s+null/.test(conflito), conflito);
});

// A chave de IA mora no servidor. Se o app voltar a falar direto com um provedor, a
// chave voltou para o aparelho — e para quem abrir o código da página.
await teste("o app não fala com provedor de IA nem guarda chave", async () => {
  for (const host of ["api.groq.com", "api.openai.com", "generativelanguage.googleapis.com"])
    conferir(`nenhuma chamada a ${host}`, !html.includes(host));
  conferir("nenhuma chave no estado sincronizado", !/chaves\s*:/.test(html));
  // a voz passa pelo Whisper no servidor; o reconhecimento do navegador erra em português
  conferir("voz não usa o reconhecimento do navegador", !/SpeechRecognition/.test(html));
});

if (falhas) {
  console.error(`\n${falhas} de ${feitos} conferências falharam`);
  process.exit(1);
}
console.log(`✓ ${feitos} conferências da camada de servidor passaram`);
