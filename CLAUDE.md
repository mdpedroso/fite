# FiTê — diário de alimentação e treino

Ferramenta de casa para duas pessoas, usada todo dia no celular. Não é produto.

Duas formas de registrar: pelo app, e por conversa comigo aqui — nesse caso **eu sou a
interface de entrada**: o usuário fala em linguagem natural, eu estimo e gravo.

---

# Princípio zero: dado não se perde

Em 21/09/2026 o app apagou quatro refeições e um treino já registrados. A causa foi a
regra de sincronização — "no mesmo dia, ganha quem gravou por último" —, que trocava o
dia inteiro de um aparelho pelo do outro. Quase tudo neste arquivo sai daí.

1. **Ausência nunca significa exclusão.** Apagar é fato registrado (lápide no JSON,
   `apagado_em` no banco). Item que sumiu sem registro é bug, não intenção.
2. **Gravação que encolhe é barrada.** Antes de escrever, compara-se com o que havia; se
   algo sumiria sem exclusão explícita, não grava e avisa. (Valia para o `fite.json`; no
   banco cada lançamento é uma linha e o app manda só o que mudou, então não há gravação
   que troque a lista inteira. `perdeuItem` segue no `index.html`, só usado pelos testes.)
3. **Backup é nosso, não do provedor.** Nenhum plano gratuito guarda o que a gente
   precisa. Dump diário, cifrado, fora do provedor, com restauração testada.
   **Ainda não existe** — não há script nem agendamento de dump.
4. **Mudou a camada de dados? O teste vem antes da mudança.**

---

# Arquitetura

**App novo (o que vale):** `index.html` servido pelo Vercel em https://fite-psi.vercel.app,
com funções em `api/*.ts` (TypeScript) sobre `lib/*.ts`. Dados no Postgres do Supabase
(São Paulo), fotos no bucket privado `fotos` do Supabase Storage, chave de IA (Groq) no
banco, entrada só pelo Google. Utilitários (migração, contas, consultas) em Python, em `db/`.

**App velho:** `velho.html`, no GitHub Pages (https://mdpedroso.github.io/fite/velho.html),
ainda lê e grava `fite.json` no Google Drive de cada pessoa. Fica no ar só para exportar
o que ainda não migrou (Perfil → "Baixar tudo num arquivo"). Nada novo deve ser lançado
nele. A raiz do Pages serve o app novo, que avisa que mudou de endereço.

**Limites do plano gratuito do Vercel:** no máximo **12 funções** — cada arquivo em `api/`
é uma. O 13º faz o deploy falhar na publicação (o build passa). Rota nova entra como
método numa rota existente, não como arquivo novo.

Decisões que sustentam isso:

- **Auth própria**, não a do provedor: usuários e sessões são linhas no nosso banco, então
  trocar de hospedagem é mover um container, não reconstruir contas.
- **Data API do Supabase desligada** (conferido no painel em 22/09: Project Settings →
  Data API → "Enable Data API" desligado; pelo banco não dá para ver): o navegador não
  fala com o banco. Quem consulta é o backend, com a connection string.
  Atenção: os papéis `anon` e `authenticated` ainda têm permissão total em todas as
  tabelas de `public` — se a Data API for ligada, tudo fica exposto. Falta o `revoke`.
- **Chave de IA no servidor**: chave no navegador é chave entregue. O app chama
  `/api/ia`, que chama o Groq com a chave da tabela `chave_ia`. Quem cadastra a chave é o
  admin, na aba Admin do app; quem usa o app não configura nada.
- **Fotos pelo backend**: `/api/foto` sobe e devolve a foto; o caminho no bucket começa
  pelo id do usuário e só o dono lê. A cópia no aparelho (IndexedDB) só vive até a foto
  estar no servidor e estimada.
- **TypeScript no back web**: o formato de uma refeição é declarado uma vez e vale no
  servidor e na tela.

## Os dois lugares onde os dados vivem

| onde | o que guarda | quem escreve |
|------|--------------|--------------|
| `data/*.jsonl` | histórico completo, com `raw` e `confidence` | eu, ao registrar por conversa |
| banco (Postgres no Supabase) | o que o app mostra e edita | o app |

O `data/` é mais rico de propósito: guarda o que foi dito e o quanto confiei na
estimativa, o que permite reprocessar tudo depois. **Nunca reescrever ou apagar linhas
de `data/`** — correção é um evento novo com `corrects: "<id>"`.

---

# Modelo do banco

Migrações numeradas em `db/migracoes/`, aplicadas com `db/rodar.py`.

- `usuario`, `admin`, `sessao` — contas (001).
- `refeicao`, `treino` — uma linha por lançamento, com `ordem` para arrastar na lista,
  `bruto` (o que a pessoa escreveu), `interpretacao` (como o modelo entendeu), `llm`
  (quem estimou, como `provedor/modelo`: `groq/qwen3.8-27b`) e `foto_url` (caminho no
  bucket). Refeição **não tem slot** (café, ceia…): a coluna saiu na 005.
- Lançamento com texto ou foto, sem kcal e sem `llm` é um que a IA ainda não estimou: o
  app o trata como pendente. O banco não guarda "pendente".
- `medicao` — métricas do corpo no formato `(dia, metrica, valor)`. A chave é texto e o
  catálogo (rótulo, unidade, faixa válida, casas decimais) mora **no backend**: métrica
  nova não exige mexer no banco. Peso é `peso_kg`.
- `dia_ignorado`, `perfil`.
- `integracao` — chave do intervals.icu por usuário (003).
- `chave_ia` — chave de IA da casa, uma linha por serviço (004). Não é por usuário.
- Treino vindo de fora usa `fonte` + `external_id`, únicos juntos: id externo só é único
  dentro do sistema que o emitiu.
- Nada derivado é gravado (IMC se calcula de peso e altura).
- `atualizado_em` é mantido por trigger (`marca_atualizacao`), não pelo código.

# Regras de dados

- **Uma linha por lançamento.** Nada de documento por dia, que é o que permitiu a perda.
- **Toda linha sabe quando mudou** (`atualizado_em`) e se morreu (`apagado_em`).
- **Toda consulta filtra por usuário no backend.** O navegador manda o cookie de sessão,
  nunca "de quem é o dado". Se a tela puder pedir `?usuario=X`, acabou a segurança.
- **O banco ainda não filtra.** Não há RLS nem `set local app.usuario`: a única proteção
  é o `where usuario = $1` do backend, conferido rota a rota em 22/09. A meta continua
  sendo o banco filtrar também, para a proteção não depender de alguém lembrar do `where`.
- **Ninguém vê o diário do outro.** Se um dia precisar, o acesso tem que ser explícito
  (uma tabela, visível e revogável pelo dono), não "papel = dono vê tudo" no código. Essa
  tabela não existe hoje.

# Contas: a linha é a permissão

Não existe cadastro por conta própria. **Quem entra é quem já tem linha em `usuario`**,
criada por nós. O login do Google só valida a identidade e carimba `google_sub` numa
linha existente; e-mail sem linha é recusado, mesmo com conta Google válida. Isso
substitui a lista de e-mails em hash que ficava no código, que era sinalização.

- **Identidade é o e-mail** (`citext`, único). A chave primária é um uuid porque e-mail
  muda, e trocá-lo não pode obrigar a reescrever o diário inteiro.
- **Só vincula `google_sub` se o ID token trouxer `email_verified: true`.**
- **Revogar é `ativo = false`, nunca `delete`** — a linha tem `on delete cascade` e
  levaria refeições, treinos e pesos junto.
- Permissão de administrador sai da tabela `admin`.
- Contas se gerenciam por `db/usuario.py` (`--listar`, `--add`, `--desativar`).

# Brasil: fuso, data e número

O servidor do banco está em **UTC** e o `DateStyle` é `ISO, MDY`. Daí três regras:

- **O dia é decidido no backend, nunca pelo banco.** `current_date` no servidor vira o
  dia às 21h de Brasília. `hojeISO()` (`lib/db.ts`) calcula o dia em `America/Sao_Paulo`
  e toda data vai explícita na consulta. A conexão não declara fuso.
- **Data sempre em ISO** (`2026-09-22`). Com `MDY`, mandar `22/09/2026` é pedir erro.
- **Número guarda ponto, exibe vírgula.** `85,4` é formatação de tela
  (`toLocaleString("pt-BR")`), nunca o valor gravado.

O banco é UTF8 e ordena acento corretamente (`Ágata < Água < arroz < Zebra`), então não
há nada a fazer quanto a charset. Se um dia houver busca textual, trocar a configuração
de `english` para `portuguese`.

# Banco: nada roda sem autorização

O `DATABASE_URL` fica em `.env` na máquina do Marcos, fora do Git. Posso ler e consultar.

**Toda DDL é proposta e aprovada antes de rodar** — `create`, `alter`, `drop`, índice,
política, trigger, extensão. Eu mostro o SQL exato, explico o porquê, espero o "pode".
Sem exceção, nem para "só um índice".

O mesmo vale para qualquer escrita que não seja o uso normal do app: `update` em massa,
`delete`, `truncate`, migração de dados. Consulta de leitura (`select`) eu faço à vontade.

Antes de qualquer DDL que mexa em tabela com dado dentro: dump primeiro.

# Segurança

- Não há senha: a entrada é só pelo Google (ID token conferido em `lib/google.ts`).
- Sessão: token opaco de 32 bytes em cookie `httpOnly; Secure; SameSite=Lax`, com linha
  na tabela `sessao`. Preferido a JWT porque revoga na hora e não tem chave a rotacionar.
- Admin é conferido no servidor (`quem.admin`, da tabela `admin`); esconder a aba na tela
  é conforto, não segurança.
- **Pendente:** limite de chamadas no login e em `/api/ia` (qualquer conta gasta a chave
  do Groq sem limite); escapar texto de lançamento antes de pôr no `innerHTML`.
- Segredos vivem em variáveis de ambiente e `.env` fora do Git. Nunca no repositório,
  nunca no chat.

# Testes

- `app/testes-dados.mjs` e `app/testes-servidor.mjs` rodam no `pre-commit` e **travam o
  commit** se falharem. Os dois extraem o código do próprio `index.html` — testar uma
  cópia não provaria nada.
- `testes-dados`: a mescla do `fite.json` (caso de 21/09 item a item, exclusão entre
  aparelhos, offline, lápide expirando, dois fuzzes).
- `testes-servidor`: a camada que leva o diário ao banco, contra um servidor de mentira —
  envio sem duplicar (recarregar, envios simultâneos), exclusão, offline, pendente,
  fotos entre aparelhos, treino apagado que não volta, e que o app não fala com provedor
  de IA nem guarda chave.
- Não há teste contra Postgres de verdade: SQL é conferido lendo o arquivo.
- Invariante de todo teste novo: **nada some sem exclusão, nada apagado ressuscita.**

# Deploy e versão

- `git push` publica no Vercel (app novo) e no GitHub Pages (app velho). O hook
  `app/pre-commit` roda os testes, carimba `const VERSAO` no `index.html` e no
  `velho.html` e grava `versao.txt`. Se o hook sumir:
  `cp app/pre-commit .git/hooks/ && chmod +x .git/hooks/pre-commit`.
- Deploy conferido por `versao.txt` no ar e pelo status do commit no GitHub
  (`gh api repos/mdpedroso/fite/commits/<sha>/statuses`); log com `npx vercel inspect <id> --logs`.
- O app compara as versões e mostra a tarja amarela "versão nova", que recarrega por
  `?v=<versão>`. `.nojekyll` evita o build Jekyll no Pages.
- Variáveis no Vercel: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (fotos).
  O `DATABASE_URL` do Vercel é o **pooler em modo transaction (porta 6543)**; em modo
  session (5432) o limite é de 15 conexões presas, e em 22/09 isso derrubou o app. O
  `.env` local usa a conexão direta (`db.<ref>.supabase.co:5432`), que serve para os
  scripts.
  Variável nova só vale a partir do deploy seguinte.
- **Nada é dado por pronto sem conferir no site publicado.** Deploy que não foi aberto e
  medido não conta como feito.

# Convenções de código

- **Nomes em português** (`mesclarEstados`, `pesoEm`, `lerBackups`). O domínio é em
  português; traduzir só atrapalha.
- **Comentário explica por quê, não o quê.**
- Mudança de layout se confere medindo no navegador (posição, largura, altura), não no olho.
- O app é um arquivo que abre: sem framework, sem build.

---

# Como registrar por conversa

**Só registro quando o usuário mandar registrar.** Mencionar comida, treino ou peso na
conversa não é ordem de gravar. Em 22/09/2026 gravei refeições, treinos e pesos sem ser
mandado, e tudo teve de ser apagado. Nada entra em `data/` nem no banco por iniciativa
minha: nem carga, nem migração, nem seed, nem exemplo.

Quando ele mandar, gravo sem enrolar: nada de três perguntas antes de cada refeição.

```bash
echo '{"who":"marcos","type":"meal",...}' | python3 app/log.py
```

Depois de gravar, responder em **uma ou duas linhas**: o total de kcal, o acumulado do
dia, e as suposições que fiz. Sem tabela, sem resumo longo. O usuário corrige se quiser;
não é preciso oferecer.

## Estimativa

- Sempre gravar kcal **e** macros (`p`/`c`/`g` em gramas). Macro não coletado hoje é
  macro perdido pra sempre; o custo de gravar é zero.
- Quebrar em `items` — permite corrigir um item sem refazer a refeição toda.
- Porções brasileiras reais ("prato de comida", "pão francês" = ~50g).
- Na dúvida sobre preparo, assumir o mais comum no Brasil, marcar `confidence: "med"` e
  **dizer a suposição na resposta**.
- `confidence`: `high` quando a pessoa deu quantidade e preparo; `med` quando o prato é
  claro mas a porção é inferida; `low` quando é chute (ex: "comi num japonês").
- Se a pessoa informar um número (calorias do relógio, peso da balança), `source: "user"`
  e sem `confidence`. **Nunca sobrescrever número informado com estimativa minha.**
- A soma é minha, não do modelo: o total da refeição é a soma dos itens, calculada no
  código. Modelo de linguagem erra conta.

## Perguntar, só quando muda muito

Perguntar apenas se a resposta muda a estimativa em mais de ~50%. "Comi pizza" (2 fatias
ou 8?) merece pergunta. "Comi um pão" não.

## O slot é o dado; o horário não é

A pessoa fala por refeição ("café da manhã"), não por relógio. **Nunca perguntar horário
e nunca exibir horário.** O `ts` existe só para ordenar o dia e saber a data — derivado
do slot, no fuso America/Sao_Paulo:

`cafe` 08:00 · `lanche_manha` 10:30 · `almoco` 12:30 · `lanche_tarde` 16:00 ·
`janta` 20:00 · `ceia` 22:00

Só quando a pessoa disser a hora espontaneamente, usar a hora dita e marcar
`time_exact: true`.

## "Ontem", "no domingo"

`ts` é quando o fato aconteceu, `logged_at` é agora. Registro retroativo é normal e vai
no arquivo do mês em que aconteceu.

## Quem é quem

Default é `marcos`. Perfis em `data/profiles.json` — o campo `display` controla a
apresentação: `full` mostra kcal e déficit; `habits` mostra consistência e variedade sem
número na cara.

---

# Registro de decisões

| Quando | Decisão | Por quê |
|---|---|---|
| 20/09 | LLM estima sempre, sem catálogo local | catálogo engessa e envelhece |
| 21/09 | GitHub Pages com login Google | standalone não funciona: sem OAuth nem storage |
| 21/09 | intervals.icu no lugar do Strava | Strava passou a cobrar pela API |
| 21/09 | Peso vigente por dia | pesar-se hoje não pode mudar o saldo de ontem |
| 22/09 | Mescla item a item com lápides | a regra anterior apagou dados reais |
| 22/09 | Migrar para Postgres com backend próprio | tira a sincronização caseira do caminho |
| 22/09 | Supabase (São Paulo), Data API desligada | banco gerenciado perto, sem superfície pública |
| 22/09 | Backend em TypeScript | tipo compartilhado entre servidor e tela |
| 22/09 | Um só CLAUDE.md | o que precisa valer sempre tem que estar no arquivo que sempre carrega |
| 22/09 | Entrada só pelo Google, sem senha | menos código de auth para manter; conta já existe |
| 22/09 | Chave de IA da casa, cadastrada pelo admin | a Isa não precisa saber o que é chave; chave fora do navegador |
| 22/09 | Só Groq como motor de IA | um motor basta por ora; Gemini e ChatGPT saíram do app |
| 22/09 | Fotos em bucket privado, servidas pelo backend | foto aparece em qualquer aparelho e só para o dono |
| 22/09 | App sempre claro, sem tema | não interessa |
| 22/09 | Usuário pré-cadastrado por nós | saber a URL e ter Gmail não pode dar acesso |
| 22/09 | App não carimba slot (café, ceia…) | não interessa; nem pela hora, nem pelo modelo |
