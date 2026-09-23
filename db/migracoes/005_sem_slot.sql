-- 005 — refeição sem slot (café, almoço, ceia…).
--
-- O app não carimba mais em que refeição do dia algo entrou: não interessa, e o palpite
-- (pela hora ou pelo modelo) errava — banana às 22h virava lanche da manhã. Coluna que
-- ninguém preenche nem lê só confunde quem olha o banco.
alter table refeicao drop column slot;
