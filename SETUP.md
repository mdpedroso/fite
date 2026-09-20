# FiTê — como colocar no ar

São três coisas, uma vez só. Ao final você tem um link que abre no celular
como app, e sua filha usa o mesmo link com a conta dela.

## 1. GitHub Pages — feito ✓

Repositório: https://github.com/mdpedroso/fite
App: **https://mdpedroso.github.io/fite/**

Para publicar uma versão nova: `git add -A && git commit -m "..." && git push`.
Em menos de um minuto está no ar.

## 2. Google — login e Drive

No [Google Cloud Console](https://console.cloud.google.com):

1. Crie um projeto (nome livre, ex. `fite`).
2. **APIs e serviços → Biblioteca** → procure **Google Drive API** → **Ativar**.
3. **Tela de permissão OAuth**:
   - Tipo: **Externo**
   - Nome do app: `FiTê` · e-mail de suporte: o seu
   - Em **Escopos**, adicione `.../auth/drive.file`
   - **Publique o app** (botão "Publicar"). Não cai em fila de revisão:
     `drive.file` é escopo não-sensível, porque só enxerga arquivos que o
     próprio app criou.
4. **Credenciais → Criar credenciais → ID do cliente OAuth**:
   - Tipo: **Aplicativo da Web**
   - **Origens JavaScript autorizadas**: `https://mdpedroso.github.io`
     (só o domínio, sem `/fite`)
   - Criar → copie o **Client ID**
5. No `index.html`, troque a linha:
   ```js
   const CLIENT_ID = "SUBSTITUIR.apps.googleusercontent.com";
   ```
   pelo Client ID copiado. Suba o arquivo de novo.

## 3. Gemini — as estimativas

No [Google AI Studio](https://aistudio.google.com/apikey) → **Create API key**.
Copie. O app pede essa chave na primeira vez que abrir — não precisa mexer no
código. Cada pessoa usa a chave dela.

> Vale travar a chave: no Cloud Console → Credenciais → a chave de API →
> **Restrições de aplicativo** → *Referenciadores HTTP* → adicione
> `https://mdpedroso.github.io/*`. Assim ela só funciona a partir do app.

## 4. Strava — opcional, só seu

Em [strava.com/settings/api](https://www.strava.com/settings/api):

- **Authorization Callback Domain**: `mdpedroso.github.io`
- Anote **Client ID** e **Client Secret**

No app: aba **Perfil** → Strava → cole os dois, escolha a data de início e
**Conectar**. Ele vai ao Strava, você autoriza, volta conectado. Depois é só
**Buscar treinos novos**.

O Client Secret fica guardado **no seu aparelho**, nunca no código — por isso
não há problema no repositório ser público.

---

## Liberar mais alguém

O app só aceita os e-mails da lista `EMAILS_OK` no `index.html`, guardados como
hash para não virarem alvo de spam num repositório público. Para gerar o de
alguém novo:

```bash
python3 -c "import hashlib,sys; print(hashlib.sha256(sys.argv[1].strip().lower().encode()).hexdigest())" email@exemplo.com
```

Cole o resultado na lista e suba o arquivo.

**Isto não é uma tranca de verdade** — o código é público e roda no navegador,
então dá para contornar. O que protege os dados é o login do Google: cada
pessoa só alcança o próprio Drive. A lista serve para deixar claro que o app é
de uso familiar, não para guardar segredo.

## O que fica onde

| o quê | onde |
|---|---|
| o app | GitHub Pages, público |
| seus dados | `fite.json`, no seu Drive |
| chave do Gemini | seu aparelho |
| credenciais do Strava | seu aparelho |
