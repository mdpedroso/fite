-- 003 — chaves de serviços externos, por usuário.
--
-- Hoje a chave do intervals.icu mora no aparelho: cada celular precisa colar de novo, e
-- quem importa o treino é o navegador. Com a chave aqui, quem busca é o backend — a
-- importação deixa de depender do app estar aberto.
--
-- A chave fica em texto: ela é lida a cada busca, e guardar cifrada exigiria uma chave de
-- cifra no servidor, que teria o mesmo problema de guarda. O que protege é o acesso ao
-- banco. Se um dia isto virar segredo de verdade (senha bancária, por exemplo), muda.
create table integracao (
  usuario       uuid not null references usuario on delete cascade,
  servico       text not null,               -- 'intervals'; 'strava', 'garmin' se vierem
  chave         text not null,
  externo_id    text,                        -- id do atleta no serviço
  rotulo        text,                        -- nome que o serviço devolveu, só para a tela
  ultima_busca  timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (usuario, servico)
);

create trigger integracao_marca_atualizacao before update on integracao
  for each row execute function marca_atualizacao();
