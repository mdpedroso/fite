// Testes da camada de dados do FiTê: mescla entre aparelhos, exclusão e a trava
// contra gravar um estado que perde item. Roda com `node app/testes-dados.mjs`.
//
// As funções vêm do próprio index.html publicado — testar uma cópia não provaria nada.
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const pega = re => {
  const m = html.match(re);
  if(!m) throw new Error("não achei no index.html: " + re);
  return m[0];
};
const fonte =
  pega(/const chaveItem = [\s\S]*?\nfunction unirListas[\s\S]*?\n}\n/) +
  pega(/const LAPIDE_DIAS[\s\S]*?function mesclarEstados[\s\S]*?\n}\n/) +
  pega(/function perdeuItem[\s\S]*?\n}\n/);
const { mesclarEstados, chaveItem, perdeuItem } =
  new Function(fonte + "; return {mesclarEstados, chaveItem, perdeuItem};")();

/* ---------- modelo de aparelho ---------- */
// Cada aparelho tem seu estado. Sincronizar é o que o app faz ao gravar:
// lê o remoto, mescla com o que tem, adota o resultado e grava de volta.
const vazio = () => ({versao:3, ts:{}, tsGeral:0, dias:{}, wk:{}, ocultos:{}, apagados:{}, pesos:[], perfil:{}});
const clonar = e => JSON.parse(JSON.stringify(e));

class Nuvem {
  constructor(){ this.estado = null; this.gravacoes = 0; }
  ler(){ return this.estado ? clonar(this.estado) : null; }
  gravar(e){
    // a mesma trava do app: uma gravação não pode perder item que ninguém apagou
    const perdidos = this.estado ? perdeuItem(this.estado, e) : [];
    if(perdidos.length) throw new Error("gravação perdeu itens: " + perdidos.join(", "));
    this.estado = clonar(e); this.gravacoes++;
  }
}

class Aparelho {
  constructor(nome, nuvem){ this.nome = nome; this.nuvem = nuvem; this.estado = vazio(); }
  add(iso, item, tipo = "dias"){
    (this.estado[tipo][iso] ||= []).push(item);
    this.estado.ts[iso] = this.estado.tsGeral = ++Aparelho.relogio;
    return item;
  }
  apagar(iso, id, tipo = "dias"){
    const arr = this.estado[tipo][iso] || [];
    const i = arr.findIndex(x => x.id === id);
    if(i < 0) return false;
    (this.estado.apagados[iso] ||= {})[chaveItem(arr[i])] = ++Aparelho.relogio;
    arr.splice(i, 1);
    this.estado.ts[iso] = this.estado.tsGeral = Aparelho.relogio;
    return true;
  }
  sincronizar(){
    const remoto = this.nuvem.ler();
    this.estado = mesclarEstados(this.estado, remoto);
    this.nuvem.gravar(this.estado);
  }
  itens(iso, tipo = "dias"){ return (this.estado[tipo][iso] || []).map(x => x.id).sort(); }
}
Aparelho.relogio = Date.now();   // relógio de verdade: a lápide tem prazo de validade

/* ---------- helpers de teste ---------- */
let testes = 0, falhas = [];
function teste(nome, fn){
  testes++;
  try{ fn(); }
  catch(e){ falhas.push(`${nome}: ${e.message}`); }
}
const igual = (a, b, msg) => {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if(A !== B) throw new Error(`${msg || ""} esperado ${B}, veio ${A}`);
};

const HOJE = "2026-09-22", ONTEM = "2026-09-21";

/* ---------- cenários ---------- */

teste("o caso de ontem: dois aparelhos no mesmo dia, nenhum perde", () => {
  const nuvem = new Nuvem(), cel = new Aparelho("cel", nuvem), pc = new Aparelho("pc", nuvem);
  cel.add(ONTEM, {id:"cafe"}); cel.add(ONTEM, {id:"almoco"});
  cel.sincronizar();
  pc.sincronizar();                                   // pc fica com os dois
  cel.add(ONTEM, {id:"banana"}); cel.add(ONTEM, {id:"sopa"});
  cel.add(ONTEM, {id:"doce"});   cel.add(ONTEM, {id:"mamao"});
  cel.sincronizar();
  pc.add(ONTEM, {id:"janta"});                        // pc mexe sem ter visto os novos
  pc.sincronizar();
  cel.sincronizar();
  igual(pc.itens(ONTEM), ["almoco","banana","cafe","doce","janta","mamao","sopa"], "no pc:");
  igual(cel.itens(ONTEM), ["almoco","banana","cafe","doce","janta","mamao","sopa"], "no celular:");
});

teste("exclusão feita num aparelho chega no outro", () => {
  const nuvem = new Nuvem(), a = new Aparelho("a", nuvem), b = new Aparelho("b", nuvem);
  a.add(HOJE, {id:"x"}); a.add(HOJE, {id:"y"}); a.sincronizar(); b.sincronizar();
  a.apagar(HOJE, "x"); a.sincronizar();
  b.sincronizar();
  igual(b.itens(HOJE), ["y"], "depois de apagar:");
});

teste("item apagado não volta quando o outro aparelho sincroniza atrasado", () => {
  const nuvem = new Nuvem(), a = new Aparelho("a", nuvem), b = new Aparelho("b", nuvem);
  a.add(HOJE, {id:"x"}); a.sincronizar(); b.sincronizar();     // b tem o x
  a.apagar(HOJE, "x"); a.sincronizar();                        // a apaga e publica
  b.sincronizar();                                             // b chega depois com o x vivo
  igual(b.itens(HOJE), [], "b depois de sincronizar:");
  b.sincronizar();
  igual(b.itens(HOJE), [], "b de novo:");
});

teste("aparelho que ficou dias fora não apaga o que foi feito nesse tempo", () => {
  const nuvem = new Nuvem(), a = new Aparelho("a", nuvem), b = new Aparelho("b", nuvem);
  a.add(ONTEM, {id:"velho"}); a.sincronizar(); b.sincronizar();
  for(let i = 0; i < 5; i++){ a.add(ONTEM, {id:"novo"+i}); a.sincronizar(); }
  b.add(ONTEM, {id:"doB"});                                    // b estava offline o tempo todo
  b.sincronizar();
  igual(b.itens(ONTEM), ["doB","novo0","novo1","novo2","novo3","novo4","velho"], "depois que b voltou:");
});

teste("treinos seguem a mesma regra das refeições", () => {
  const nuvem = new Nuvem(), a = new Aparelho("a", nuvem), b = new Aparelho("b", nuvem);
  a.add(HOJE, {id:"corrida"}, "wk"); a.sincronizar(); b.sincronizar();
  b.add(HOJE, {id:"musculacao"}, "wk"); b.sincronizar();
  a.add(HOJE, {id:"bike"}, "wk"); a.sincronizar();
  igual(a.itens(HOJE, "wk"), ["bike","corrida","musculacao"], "treinos:");
});

teste("dia ignorado é decisão que gruda", () => {
  const nuvem = new Nuvem(), a = new Aparelho("a", nuvem), b = new Aparelho("b", nuvem);
  a.add(ONTEM, {id:"x"}); a.sincronizar(); b.sincronizar();
  a.estado.ocultos[ONTEM] = true; a.sincronizar();
  b.sincronizar();
  if(!b.estado.ocultos[ONTEM]) throw new Error("o outro aparelho não viu o dia ignorado");
});

teste("lápide velha demais deixa de pesar", () => {
  const antiga = {...vazio(), apagados:{[ONTEM]: {"x": Date.now() - 200*86400000}}};
  const m = mesclarEstados(antiga, vazio());
  if(m.apagados[ONTEM]) throw new Error("lápide de 200 dias devia ter sido descartada");
});

teste("item sem id é reconhecido pelo conteúdo, não duplica", () => {
  const nuvem = new Nuvem(), a = new Aparelho("a", nuvem), b = new Aparelho("b", nuvem);
  a.add(HOJE, {desc:"pão com ovo", kc:420, raw:"pão com ovo"});
  a.sincronizar(); b.sincronizar();
  b.sincronizar(); a.sincronizar();
  igual((a.estado.dias[HOJE] || []).length, 1, "quantidade depois de idas e vindas:");
});

teste("a trava barra uma gravação que perderia item", () => {
  const nuvem = new Nuvem(), a = new Aparelho("a", nuvem);
  a.add(HOJE, {id:"x"}); a.add(HOJE, {id:"y"}); a.sincronizar();
  const encolhido = clonar(a.estado);
  encolhido.dias[HOJE] = encolhido.dias[HOJE].filter(i => i.id !== "y");   // sumiço sem lápide
  let barrou = false;
  try{ nuvem.gravar(encolhido); }catch(e){ barrou = true; }
  if(!barrou) throw new Error("a trava deixou passar");
});

teste("a trava deixa passar exclusão de verdade", () => {
  const nuvem = new Nuvem(), a = new Aparelho("a", nuvem);
  a.add(HOJE, {id:"x"}); a.add(HOJE, {id:"y"}); a.sincronizar();
  a.apagar(HOJE, "y");
  a.sincronizar();                       // não pode lançar
  igual(a.itens(HOJE), ["x"], "depois da exclusão:");
});

/* ---------- fuzz: três aparelhos mexendo ao mesmo tempo ---------- */
function sorteio(semente){
  let x = semente;
  return (n) => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x % n; };
}
teste("fuzz: 300 rodadas de três aparelhos, nada some sem exclusão", () => {
  for(let rodada = 0; rodada < 300; rodada++){
    const r = sorteio(rodada + 1);
    const nuvem = new Nuvem();
    const devs = ["a","b","c"].map(n => new Aparelho(n, nuvem));
    const vivos = new Set(), apagados = new Set();
    let seq = 0;
    for(let passo = 0; passo < 40; passo++){
      const d = devs[r(devs.length)];
      const iso = [HOJE, ONTEM][r(2)];
      const acao = r(10);
      if(acao < 5){                                   // lançar
        const id = "i" + (seq++);
        d.add(iso, {id}); vivos.add(iso + "/" + id);
      }else if(acao < 7){                             // apagar algo que este aparelho vê
        const arr = d.estado.dias[iso] || [];
        if(arr.length){
          const alvo = arr[r(arr.length)].id;
          d.apagar(iso, alvo);
          vivos.delete(iso + "/" + alvo); apagados.add(iso + "/" + alvo);
        }
      }else{                                          // sincronizar
        d.sincronizar();
      }
    }
    devs.forEach(d => d.sincronizar());
    devs.forEach(d => d.sincronizar());               // segunda volta: todos convergem
    for(const d of devs){
      for(const chave of vivos){
        const [iso, id] = chave.split("/");
        if(!d.itens(iso).includes(id))
          throw new Error(`rodada ${rodada}: ${d.nome} perdeu ${chave}`);
      }
      for(const chave of apagados){
        const [iso, id] = chave.split("/");
        if(d.itens(iso).includes(id))
          throw new Error(`rodada ${rodada}: ${d.nome} ressuscitou ${chave}`);
      }
    }
  }
});

teste("fuzz: sincronizar na ordem trocada dá o mesmo resultado", () => {
  for(let rodada = 0; rodada < 200; rodada++){
    const r = sorteio(rodada + 7);
    const montar = () => {
      const nuvem = new Nuvem();
      const devs = ["a","b"].map(n => new Aparelho(n, nuvem));
      return {nuvem, devs};
    };
    const roteiro = [];
    for(let i = 0; i < 20; i++) roteiro.push([r(2), r(3)]);
    const rodar = ordem => {
      const {devs} = montar();
      let seq = 0;
      for(const [qual, acao] of roteiro){
        const d = devs[ordem ? qual : 1 - qual];
        if(acao === 0) d.add(HOJE, {id:"k" + (seq++)});
        else d.sincronizar();
      }
      devs.forEach(d => d.sincronizar());
      devs.forEach(d => d.sincronizar());
      return devs[0].itens(HOJE);
    };
    const um = rodar(true), outro = rodar(false);
    if(um.length !== outro.length)
      throw new Error(`rodada ${rodada}: ${um.length} itens numa ordem e ${outro.length} na outra`);
  }
});

/* ---------- resultado ---------- */
if(falhas.length){
  console.error(`✗ ${falhas.length} de ${testes} falharam:`);
  falhas.forEach(f => console.error("  - " + f));
  process.exit(1);
}
console.log(`✓ ${testes} testes de dados passaram`);
