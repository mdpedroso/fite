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
   algo sumiria sem exclusão explícita, não grava e avisa.
3. **Backup é nosso, não do provedor.** Nenhum plano gratuito guarda o que a gente
   precisa. Dump diário, cifrado, fora do provedor, com restauração testada.
4. **Mudou a camada de dados? O teste vem antes da mudança.**

---

# Arquitetura

**Hoje:** `index.html` único no GitHub Pages, dados em `fite.json` no Google Drive de
cada pessoa, chaves de IA no aparelho.

**Para onde vai:** Postgres no Supabase (São Paulo), backend próprio em **TypeScript** no
Vercel, autenticação própria por e-mail e senha, fotos em bucket, chaves de IA no
servidor. Utilitários (migração, backup, análise de `data/`) seguem em Python.

Decisões que sustentam isso:

- **Auth própria**, não a do provedor: usuários e sessões são linhas no nosso banco, então
  trocar de hospedagem é mover um container, não reconstruir contas.
- **Data API do Supabase desligada**: o navegador não fala com o banco. Quem consulta é o
  backend, com a connection string.
- **Chaves de IA no servidor**: chave no navegador é chave entregue. O app chama uma
  função nossa, que chama o modelo.
- **TypeScript no back web**: o formato de uma refeição é declarado uma vez e vale no
  servidor e na tela.

## Os dois lugares onde os dados vivem

| onde | o que guarda | quem escreve |
|------|--------------|--------------|
| `data/*.jsonl` | histórico completo, com `raw` e `confidence` | eu, ao registrar por conversa |
| banco (hoje `fite.json` no Drive) | o que o app mostra e edita | o app |

O `data/` é mais rico de propósito: guarda o que foi dito e o quanto confiei na
estimativa, o que permite reprocessar tudo depois. **Nunca reescrever ou apagar linhas
de `data/`** — correção é um evento novo com `corrects: "<id>"`.

---

# Regras de dados

- **Uma linha por lançamento.** Nada de documento por dia, que é o que permitiu a perda.
- **Toda linha sabe quando mudou** (`atualizado_em`) e se morreu (`apagado_em`).
- **Toda consulta filtra por usuário no backend.** O navegador manda o cookie de sessão,
  nunca "de quem é o dado". Se a tela puder pedir `?usuario=X`, acabou a segurança.
- **O banco também filtra**, via RLS com `set local app.usuario`. A proteção não pode
  depender de alguém lembrar de escrever o `where`.
- **Acesso ao diário do outro é explícito** (tabela `acesso`), visível para o dono e
  revogável por ele. Nada de "papel = dono vê tudo" escondido no código.

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
  dia às 21h de Brasília. A conexão declara `America/Sao_Paulo` e, ainda assim, toda
  data vai explícita na consulta.
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

- Senha com `argon2id`; nunca em texto, em log ou em argumento de linha de comando
  (histórico do shell e lista de processos vazam).
- Sessão: token opaco de 32 bytes em cookie `httpOnly; Secure; SameSite=Lax`, com linha
  na tabela `sessao`. Preferido a JWT porque revoga na hora e não tem chave a rotacionar.
- Rate limit no login, por e-mail e por IP.
- Segredos vivem em variáveis de ambiente e `.env` fora do Git. Nunca no repositório,
  nunca no chat.

# Testes

- `app/testes-dados.mjs` roda no `pre-commit` e **trava o commit** se falhar. Ele extrai
  as funções do próprio `index.html` — testar uma cópia não provaria nada.
- Cobre: o caso de 21/09 item a item, exclusão entre aparelhos, aparelho dias offline,
  lápide expirando, e dois fuzzes (3 aparelhos × 300 rodadas; ordem trocada × 200).
- Invariante de todo teste novo: **nada some sem exclusão, nada apagado ressuscita.**

# Deploy e versão

- `git push` publica. O hook `app/pre-commit` roda os testes, carimba `const VERSAO` no
  `index.html` e grava `versao.txt`. Se o hook sumir:
  `cp app/pre-commit .git/hooks/ && chmod +x .git/hooks/pre-commit`.
- O app compara os dois e mostra a tarja amarela "versão nova", que recarrega por
  `?v=<versão>` — o GitHub Pages guarda a página por 10 minutos e um refresh comum
  devolve a cópia velha. `.nojekyll` evita o build Jekyll.
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

Quando o usuário mencionar comida, treino, peso ou algo relevante da rotina:
**registrar na hora, sem pedir confirmação.** O ponto do projeto é atrito zero — se eu
perguntar três coisas antes de cada refeição, ele para de usar.

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
| 22/09 | Usuário pré-cadastrado por nós | saber a URL e ter Gmail não pode dar acesso |
