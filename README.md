# FiTê

Diário de alimentação e treino para uso pessoal. Um arquivo HTML que roda no
navegador do celular e conecta em três serviços do próprio usuário:

- **Google Drive** — guarda os dados (`fite.json`), com escopo `drive.file`:
  o app só enxerga arquivos que ele mesmo criou.
- **Gemini** — estima calorias e macronutrientes a partir de texto ou de uma
  foto da refeição.
- **Strava** — importa treinos, com as calorias medidas quando existem e uma
  estimativa por MET quando não.

Não há servidor. O app é estático; cada pessoa usa a própria conta Google, a
própria chave do Gemini e, se quiser, o próprio Strava. Segredos ficam no
aparelho, nunca no código.

## Como funciona o cálculo

O gasto do dia é `basal + rotina + treino`, e não um "fator de atividade"
único. Isso importa: o fator moderado que a maioria das calculadoras usa já
embute exercício, e somar o treino registrado por cima contaria duas vezes —
num dia forte, mais de 400 kcal de erro, o suficiente para inverter o sinal do
saldo. Aqui o fator cobre só a vida cotidiana e o treino entra pelo que foi de
fato feito. Detalhes em [`app/CALCULOS.md`](app/CALCULOS.md).

## Publicar

Veja [`SETUP.md`](SETUP.md).
