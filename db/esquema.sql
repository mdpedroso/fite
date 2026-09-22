-- FiTê — esquema do Postgres (Neon).
-- Regras que vêm da dor de 21/09: uma linha por lançamento, exclusão é coluna preenchida
-- (nunca ausência), e toda linha sabe quando mudou. Nenhum "arquivo do dia" para
-- um aparelho sobrescrever do outro.

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- e-mail sem caso

-- ---------- quem entra ----------
create table if not exists usuario (
  id          uuid primary key default gen_random_uuid(),
  email       citext unique not null,
  senha_hash  text not null,
  nome        text,
  papel       text not null default 'pessoa',   -- 'dono' pode mexer nos segredos
  criado_em   timestamptz not null default now()
);

create table if not exists sessao (
  token      text primary key,                  -- 32 bytes aleatórios, opaco
  usuario    uuid not null references usuario on delete cascade,
  criada_em  timestamptz not null default now(),
  expira_em  timestamptz not null,
  ua         text
);
create index if not exists sessao_usuario on sessao(usuario);
create index if not exists sessao_expira on sessao(expira_em);

-- tentativa de login, para travar força bruta
create table if not exists tentativa_login (
  id        bigserial primary key,
  email     citext,
  ip        inet,
  quando    timestamptz not null default now(),
  sucesso   boolean not null
);
create index if not exists tentativa_recente on tentativa_login(email, quando desc);

-- ---------- o diário ----------
create table if not exists refeicao (
  id            uuid primary key default gen_random_uuid(),
  usuario       uuid not null references usuario on delete cascade,
  dia           date not null,
  slot          text,
  descricao     text not null,
  bruto         text,                    -- o que a pessoa escreveu, palavra por palavra
  interpretacao text,                    -- como o modelo entendeu
  kcal          int  not null default 0,
  p             int  not null default 0,
  c             int  not null default 0,
  g             int  not null default 0,
  itens         jsonb,                   -- quebra por alimento, quando houver
  foto_url      text,
  via           text,                    -- motor que estimou
  origem_id     text,                    -- id que o item tinha no fite.json
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  apagado_em    timestamptz
);
create unique index if not exists refeicao_origem on refeicao(usuario, origem_id) where origem_id is not null;
create index if not exists refeicao_dia on refeicao(usuario, dia) where apagado_em is null;

create table if not exists treino (
  id            uuid primary key default gen_random_uuid(),
  usuario       uuid not null references usuario on delete cascade,
  dia           date not null,
  modalidade    text not null default 'outro',
  titulo        text not null,
  detalhe       text,
  bruto         text,
  kcal          int  not null default 0,
  kcal_medido   boolean not null default false,   -- veio do relógio, não é estimativa
  icu_id        text,                             -- id no intervals.icu, evita duplicar
  foto_url      text,
  via           text,
  origem_id     text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  apagado_em    timestamptz
);
create unique index if not exists treino_origem on treino(usuario, origem_id) where origem_id is not null;
create unique index if not exists treino_icu on treino(usuario, icu_id) where icu_id is not null;
create index if not exists treino_dia on treino(usuario, dia) where apagado_em is null;

create table if not exists peso (
  usuario       uuid not null references usuario on delete cascade,
  dia           date not null,
  kg            numeric(5,2) not null,
  atualizado_em timestamptz not null default now(),
  apagado_em    timestamptz,
  primary key (usuario, dia)
);

create table if not exists dia_ignorado (
  usuario    uuid not null references usuario on delete cascade,
  dia        date not null,
  quando     timestamptz not null default now(),
  primary key (usuario, dia)
);

create table if not exists perfil (
  usuario       uuid primary key references usuario on delete cascade,
  sexo          text,
  nascimento    date,
  altura_cm     int,
  fator_rotina  numeric(3,2) not null default 1.40,
  icu_desde     date,
  atualizado_em timestamptz not null default now()
);

-- ---------- o que não pode chegar ao navegador ----------
-- As chaves de IA do dono, usadas pelo servidor em nome de quem estiver logado.
create table if not exists segredo (
  nome          text primary key,        -- 'gemini', 'groq', 'openai', 'intervals'
  valor         text not null,
  atualizado_em timestamptz not null default now()
);

-- quem chamou o modelo, quando e por qual motor: serve para teto diário e para saber a conta
create table if not exists uso_ia (
  id       bigserial primary key,
  usuario  uuid references usuario on delete set null,
  quando   timestamptz not null default now(),
  motor    text,
  tipo     text,                         -- 'texto' ou 'foto'
  ok       boolean not null default true
);
create index if not exists uso_dia on uso_ia(usuario, quando desc);

-- ---------- atualizado_em sozinho ----------
create or replace function toca_atualizado() returns trigger as $$
begin new.atualizado_em = now(); return new; end $$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['refeicao','treino','peso','perfil'] loop
    execute format('drop trigger if exists %I_toca on %I', t, t);
    execute format('create trigger %I_toca before update on %I
                    for each row execute function toca_atualizado()', t, t);
  end loop;
end $$;
