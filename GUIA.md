# FiTê — guia do projeto

Diário de alimentação e treino de duas pessoas. Não é produto: é ferramenta de casa,
usada todo dia no celular. As regras abaixo existem porque cada uma delas custou caro.

## Princípio zero: dado não se perde

Em 21/09/2026 o app apagou quatro refeições e um treino já registrados. A causa foi a
regra de sincronização — "no mesmo dia, ganha quem gravou por último" —, que trocava o
dia inteiro de um aparelho pelo do outro. Tudo neste guia sai daí.

Três consequências que valem para qualquer mudança futura:

1. **Ausência nunca significa exclusão.** Apagar é um fato registrado (lápide no JSON,
   `apagado_em` no banco). Item que sumiu sem registro é bug, não intenção.
2. **Gravação que encolhe é barrada.** Antes de escrever, compara-se com o que havia.
   Se algo sumiria sem exclusão explícita, não grava e avisa.
3. **Backup é nosso, não do provedor.** Nenhum plano gratuito guarda o que você precisa.
   Dump diário, cifrado, fora do provedor, com restauração testada.

## Arquitetura

**Hoje:** `index.html` único, publicado no GitHub Pages, com os dados em `fite.json`
no Google Drive de cada pessoa e as chaves de IA no aparelho.

**Para onde vai:** Postgres no Supabase (São Paulo), backend próprio no Vercel,
autenticação própria por e-mail e senha, fotos num bucket, chaves de IA no servidor.

Decisões que sustentam essa escolha:

- **Auth própria**, não a do provedor: usuários e sessões são linhas no nosso banco,
  então trocar de hospedagem é mover um container, não reconstruir contas.
- **Data API do Supabase desligada**: o navegador não fala com o banco. Quem consulta é
  o backend, com a connection string. Menos superfície exposta.
- **Chaves de IA no servidor**: chave no navegador é chave entregue. O app chama uma
  função nossa, que chama o modelo.

## Regras de dados

- **Uma linha por lançamento.** Nada de documento por dia, que é o que permitiu a perda.
- **Toda linha sabe quando mudou** (`atualizado_em`) e se morreu (`apagado_em`).
- **Toda consulta filtra por usuário no backend.** O navegador manda o cookie de sessão,
  nunca "de quem é o dado". Se a tela puder pedir `?usuario=X`, acabou a segurança.
- **O banco também filtra**, via RLS com `set local app.usuario`. A proteção não pode
  depender de alguém lembrar de escrever o `where`.
- **Acesso ao diário do outro é explícito** (tabela `acesso`), visível para o dono e
  revogável por ele. Não existe "papel = dono vê tudo" escondido no código.
- **Registro canônico continua em `data/*.jsonl`**, append-only, com o `raw` do que foi
  dito. É o que permite reprocessar tudo se um dia a estimativa mudar.

## Segurança

- Senha com `argon2id`, nunca em texto, nunca em log, nunca em argumento de linha de
  comando (histórico do shell e lista de processos vazam).
- Sessão: token opaco de 32 bytes em cookie `httpOnly; Secure; SameSite=Lax`, com linha
  na tabela `sessao`. Escolhido em vez de JWT porque revoga na hora e não tem chave para
  rotacionar.
- Rate limit no login, por e-mail e por IP.
- Segredos (connection string, chaves de IA, senha do backup) vivem em variáveis de
  ambiente e em `.env` fora do Git. Nunca no repositório, nunca no chat.

## Testes

- `app/testes-dados.mjs` roda no `pre-commit` e **trava o commit** se falhar. Ele extrai
  as funções do próprio `index.html` — testar uma cópia não provaria nada.
- Cobre: o caso de 21/09 reproduzido item a item, exclusão entre aparelhos, aparelho que
  ficou dias offline, lápide expirando, e dois fuzzes (três aparelhos × 300 rodadas;
  ordem de sincronização trocada × 200).
- Invariante que todo teste novo deve respeitar: **nada some sem exclusão, nada apagado
  ressuscita.**
- Mudou a camada de dados? O teste vem antes da mudança, não depois.

## Deploy e versão

- `git push` publica. O hook `app/pre-commit` roda os testes, carimba `const VERSAO` no
  `index.html` e grava `versao.txt`.
- O app compara os dois e mostra a tarja amarela "versão nova". A tarja recarrega por
  `?v=<versão>` porque o GitHub Pages guarda a página por 10 minutos e um refresh comum
  devolve a cópia velha.
- **Nada é dado por pronto sem conferir no site publicado.** Deploy que não foi aberto e
  medido não conta como feito.

## Convenções de código

- **Nomes em português** (`mesclarEstados`, `pesoEm`, `lerBackups`). O domínio é em
  português; traduzir só atrapalha.
- **Comentário explica por quê, não o quê.** `// o glifo "+" da fonte não fica no centro
  da bola` vale; `// soma dois números` não.
- Uma mudança de CSS ou de layout se confere medindo no navegador (posição, largura,
  altura), não no olho.
- Sem framework, sem build. O app é um arquivo que abre.

## Registro de decisões

| Quando | Decisão | Por quê |
|---|---|---|
| 20/09 | LLM estima sempre, sem catálogo local | catálogo engessa e envelhece |
| 21/09 | GitHub Pages com login Google | standalone não funciona: sem OAuth nem storage |
| 21/09 | intervals.icu no lugar do Strava | Strava passou a cobrar pela API |
| 21/09 | Peso vigente por dia | pesar-se hoje não pode mudar o saldo de ontem |
| 22/09 | Mescla item a item com lápides | a regra anterior apagou dados reais |
| 22/09 | Migrar para Postgres com backend próprio | tira a sincronização caseira do caminho |
| 22/09 | Supabase (São Paulo), Data API desligada | banco gerenciado perto, sem superfície pública |
