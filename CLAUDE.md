# Rotina — diário de alimentação e treino

Log de comida e treino de duas pessoas, operado por conversa no Claude Code.
Não existe app de input: **eu sou a interface de entrada**. O usuário fala em
linguagem natural, eu estimo calorias/macros e gravo.

## Estrutura

- `data/` — **registro canônico**. Append-only, com o `raw` de cada fala
  preservado. Formato em `data/SCHEMA.md`.
- `app/` — código. `log.py` grava eventos; `dashboard.html` é o painel.
- `app/CALCULOS.md` — a matemática de basal, rotina e gasto.

Nunca reescrever ou apagar linhas de `data/`. Correção é um evento novo com
`corrects: "<id>"`.

## FiTê — o app

`app/index.html` é o app de verdade: HTML único, publicado no GitHub Pages,
que conecta em **Google Drive** (base), **Gemini** (estimativas, inclusive por
foto) e **intervals.icu** (treinos, via Garmin). Passos de publicação em `SETUP.md`.

Decisões que valem lembrar:

- O app **não guarda token do Google**: o acesso é renovado em silêncio
  enquanto a sessão Google do aparelho estiver ativa.
- Chaves do Gemini/ChatGPT/Groq e do intervals.icu ficam **no aparelho**, nunca no
  código — o repositório é público.
- O escopo do Drive é `drive.file`: o app só enxerga o que ele mesmo criou.
- A lista de e-mails (`EMAILS_OK`, por hash) é sinalização, não segurança.
  Quem protege os dados é o login do Google.
- O painel Artifact (`app/dashboard.html`) virou referência de design. Não é
  mais o produto.
- **Versão publicada**: o hook `app/pre-commit` (instalado em
  `.git/hooks/pre-commit`) carimba `const VERSAO` no `index.html` e grava
  `versao.txt` a cada commit. O app compara os dois e mostra a tarja "versão
  nova" com recarga. Se o hook sumir, `cp app/pre-commit .git/hooks/ && chmod +x`.
- Commits só valem depois de conferidos no site publicado; o GitHub Pages
  às vezes demora minutos para publicar (`.nojekyll` evita o build Jekyll).

## Os dois lugares onde os dados vivem

| onde | o que guarda | quem escreve |
|------|--------------|--------------|
| `data/*.jsonl` | histórico completo, com `raw` e `confidence` | eu, ao registrar por conversa |
| `fite.json` no Drive | o que o app mostra e edita | o app e eu, pelo conector do Drive |

O `data/` é mais rico de propósito: guarda o que foi dito e o quanto confiei na
estimativa, o que permite reprocessar tudo depois. Ao registrar por conversa,
escrever nos dois.

## Como registrar

Quando o usuário mencionar comida, treino, peso ou algo relevante da rotina:
**registrar na hora, sem pedir confirmação.** O ponto do projeto é atrito zero —
se eu perguntar três coisas antes de cada refeição, ele para de usar.

```bash
echo '{"who":"marcos","type":"meal",...}' | python3 app/log.py
```

Depois de gravar, responder em **uma ou duas linhas**: o total de kcal, o
acumulado do dia, e as suposições que fiz. Sem tabela, sem resumo longo.
O usuário corrige se quiser; não é preciso oferecer.

### Estimativa

- Sempre gravar kcal **e** macros (`p`/`c`/`g` em gramas). Macro não coletado
  hoje é macro perdido pra sempre; o custo de gravar é zero.
- Quebrar em `items` — permite corrigir um item sem refazer a refeição toda.
- Porções brasileiras reais ("prato de comida", "pão francês" = ~50g).
- Na dúvida sobre preparo, assumir o mais comum no Brasil, marcar
  `confidence: "med"` e **dizer a suposição na resposta**.
- `confidence`: `high` quando a pessoa deu quantidade e preparo; `med` quando
  o prato é claro mas a porção é inferida; `low` quando é chute de verdade
  (ex: "comi num restaurante japonês").
- Se a pessoa informar um número (calorias do relógio, peso da balança),
  `source: "user"` e sem `confidence`. Nunca sobrescrever número informado
  com estimativa minha.

### Perguntar, só quando muda muito

Perguntar apenas se a resposta muda a estimativa em mais de ~50%. "Comi pizza"
(2 fatias ou 8?) merece pergunta. "Comi um pão" não.

### O slot é o dado; o horário não é

A pessoa fala por refeição ("café da manhã", "lanche da tarde"), não por
relógio. **Nunca perguntar horário e nunca exibir horário.** O `ts` existe só
para ordenar o dia e saber a data — é derivado do slot, no fuso
America/Sao_Paulo:

`cafe` 08:00 · `lanche_manha` 10:30 · `almoco` 12:30 · `lanche_tarde` 16:00
· `janta` 20:00 · `ceia` 22:00

Só quando a pessoa disser a hora espontaneamente, usar a hora dita e marcar
`time_exact: true`. Fora isso o horário é andaime de ordenação, e o painel
mostra o nome do slot no lugar dele.

### "Ontem", "no domingo"

`ts` é quando o fato aconteceu, `logged_at` é agora. Registro retroativo é
normal e vai no arquivo do mês em que aconteceu.

## Quem é quem

Default é `marcos`. Perfis em `data/profiles.json` — o campo `display`
controla como o dashboard apresenta os dados de cada pessoa (`full` mostra
kcal e déficit; `habits` mostra consistência e variedade sem número na cara).
