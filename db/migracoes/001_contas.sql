-- 001 — contas, admin e sessão.
-- A linha em `usuario` é a permissão: sem linha cadastrada por nós, não se entra.
-- O login do Google só carimba `google_sub` numa linha que já existe.
create extension if not exists citext;

create table usuario (
  id         uuid primary key default gen_random_uuid(),
  email      citext unique not null,
  google_sub text unique,              -- preenchido no primeiro login
  nome       text,
  ativo      boolean not null default true,   -- revogar sem apagar: a linha leva o diário junto
  criado_em  timestamptz not null default now()
);

create table admin (
  usuario uuid primary key references usuario on delete cascade
);

create table sessao (
  token     text primary key,          -- 32 bytes aleatórios, opaco
  usuario   uuid not null references usuario on delete cascade,
  criada_em timestamptz not null default now(),
  expira_em timestamptz not null
);
create index sessao_usuario on sessao(usuario);
