-- 004 — chaves de IA, da casa e não de cada pessoa.
--
-- Antes cada aparelho guardava a própria chave e quem não sabia o que era "chave de API"
-- ficava sem estimativa. Agora o admin cadastra uma vez, e o backend chama o modelo para
-- todos: a chave nunca chega ao navegador.
--
-- Em texto, pelo mesmo motivo da `integracao` (003): o que protege é o acesso ao banco.
create table chave_ia (
  servico        text primary key,              -- 'groq'; outros se vierem
  chave          text not null,
  modelo_texto   text,                          -- descoberto e testado ao salvar
  modelo_foto    text,                          -- null: a chave não tem modelo de visão que responda
  foto_sem_json  boolean not null default false, -- o modelo de foto recusou o modo JSON
  foto_motivo    text,                          -- por que não há modelo de foto, para a tela
  testado_em     timestamptz,
  atualizado_por uuid references usuario on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create trigger chave_ia_marca_atualizacao before update on chave_ia
  for each row execute function marca_atualizacao();
