-- 002 — o diário: refeição, treino, medição, dia ignorado e perfil.
-- Uma linha por lançamento; exclusão é `apagado_em` preenchido, nunca ausência.

create table refeicao (
  id            uuid primary key default gen_random_uuid(),
  usuario       uuid not null references usuario on delete cascade,
  dia           date not null,                 -- ISO, decidido no backend (servidor é UTC)
  slot          text,                          -- "café", "almoço": livre, não é enum
  ordem         smallint not null default 0,   -- posição na lista do dia, arrastável
  descricao     text not null,
  bruto         text,                          -- o que a pessoa escreveu, palavra por palavra
  interpretacao text,                          -- como o modelo entendeu, para conferir
  kcal          int  not null default 0,
  p             int  not null default 0,
  c             int  not null default 0,
  g             int  not null default 0,
  itens         jsonb,                         -- quebra por alimento, quando houver
  foto_url      text,                          -- URL absoluta, onde quer que a foto esteja
  llm           text,                          -- modelo que estimou
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  apagado_em    timestamptz
);
create index refeicao_dia on refeicao(usuario, dia, ordem) where apagado_em is null;

create table treino (
  id            uuid primary key default gen_random_uuid(),
  usuario       uuid not null references usuario on delete cascade,
  dia           date not null,
  ordem         smallint not null default 0,
  modalidade    text not null default 'outro',
  titulo        text not null,
  detalhe       text,                          -- "12,0 km · 1h08 · 5:40 /km"
  bruto         text,
  kcal          int  not null default 0,
  kcal_medido   boolean not null default false,  -- veio do relógio; senão é estimativa
  fonte         text,                          -- 'intervals', 'strava', null se manual
  external_id   text,                          -- id no sistema de origem
  foto_url      text,
  llm           text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  apagado_em    timestamptz
);
-- id externo só é único dentro do sistema que o emitiu
create unique index treino_externo on treino(usuario, fonte, external_id)
  where external_id is not null;
create index treino_dia on treino(usuario, dia, ordem) where apagado_em is null;

-- métricas do corpo. A chave é texto e o catálogo (rótulo, unidade, faixa) mora no
-- backend: métrica nova não exige mexer no banco.
create table medicao (
  usuario       uuid not null references usuario on delete cascade,
  dia           date not null,
  metrica       text not null,                 -- 'peso_kg', 'gordura_pct', ...
  valor         numeric not null check (valor > 0),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  apagado_em    timestamptz,
  primary key (usuario, dia, metrica)
);
create index medicao_serie on medicao(usuario, metrica, dia) where apagado_em is null;

create table dia_ignorado (
  usuario uuid not null references usuario on delete cascade,
  dia     date not null,
  quando  timestamptz not null default now(),
  primary key (usuario, dia)
);

create table perfil (
  usuario        uuid primary key references usuario on delete cascade,
  sexo           text check (sexo in ('m','f')),
  nascimento     date,
  altura_cm      int check (altura_cm between 100 and 250),
  fator_rotina   numeric(3,2) not null default 1.40,
  externo_desde  date,                         -- a partir de quando importar treinos
  atualizado_em  timestamptz not null default now()
);

-- carimbo de atualização não pode depender de alguém lembrar de escrever
create function marca_atualizacao() returns trigger as $$
begin new.atualizado_em = now(); return new; end $$ language plpgsql;

create trigger refeicao_marca_atualizacao before update on refeicao
  for each row execute function marca_atualizacao();
create trigger treino_marca_atualizacao before update on treino
  for each row execute function marca_atualizacao();
create trigger medicao_marca_atualizacao before update on medicao
  for each row execute function marca_atualizacao();
create trigger perfil_marca_atualizacao before update on perfil
  for each row execute function marca_atualizacao();
