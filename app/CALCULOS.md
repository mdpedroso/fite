# Como as calorias são calculadas

## Metabolismo basal (BMR) — Mifflin-St Jeor

```
homem:  10×peso(kg) + 6.25×altura(cm) − 5×idade + 5
mulher: 10×peso(kg) + 6.25×altura(cm) − 5×idade − 161
```

É o que o corpo gasta em repouso absoluto. Sozinho não serve pra nada
prático — é o piso.

## Gasto do dia — e a armadilha do "fator de atividade"

O jeito comum é `TDEE = BMR × fator`, onde fator "moderado" (1.55) já
pressupõe 3-5 treinos por semana. **Aqui isso estaria errado**, porque nós
registramos cada treino com `kcal_out` próprio. Usar 1.55 e ainda somar o
treino conta o exercício duas vezes — num dia de treino forte o erro passa
de 400 kcal, o que inverte o sinal de um déficit moderado.

Então:

```
base  = BMR × fator_baseline        (só vida cotidiana, sem treino)
gasto = base + Σ kcal_out do dia    (treinos efetivamente registrados)
saldo = consumido − gasto
```

`fator_baseline` vem de `baseline_activity` no perfil e deve refletir o dia
SEM treino: trabalho sentado = `sedentary`/`light`.

Efeito colateral bom: dia sem treino registrado mostra gasto menor, o que é
verdade. E o número reage ao que foi de fato feito, não a uma média chutada.

## Marcos — hoje (2026-09-20)

```
idade   44 anos          peso 85 kg        altura 185 cm
BMR   = 850 + 1156 − 220 + 5              = 1791 kcal
base  = 1791 × 1.375 (light)              = 2463 kcal
IMC   = 85 / 1.85²                        = 24.8
```

Dia sem treino: gasto ~2463. Com uma hora de musculação (~380): ~2843.

## Precisão

BMR por fórmula erra ±10% entre indivíduos, e estimativa de kcal de comida
erra mais ainda. O número absoluto vale pouco; o que vale é a **tendência**
comparada ao peso real ao longo de semanas. Por isso o peso registrado é o
árbitro: se o saldo diz déficit de 500/dia há um mês e o peso não se moveu,
quem está errado é a estimativa, não a balança.
