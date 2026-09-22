// Validação do ID token do Google.
//
// Usa o endpoint `tokeninfo` em vez de verificar a assinatura JWKS aqui: login acontece
// poucas vezes por semana, então uma chamada HTTP a mais não custa nada, e isso tira do
// nosso lado a responsabilidade de cachear e rotacionar chave pública.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

export type Identidade = { email: string; nome: string | null; sub: string };

export async function validarIdToken(idToken: string): Promise<Identidade> {
  if (!CLIENT_ID) throw new Error("falta GOOGLE_CLIENT_ID");

  const r = await fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!r.ok) throw new Error("token do Google recusado");
  const d = await r.json() as Record<string, string>;

  // Sem isto, um token emitido para outro app serviria para entrar no nosso.
  if (d.aud !== CLIENT_ID) throw new Error("token emitido para outro aplicativo");
  if (d.iss !== "accounts.google.com" && d.iss !== "https://accounts.google.com")
    throw new Error("emissor inesperado");
  // Sem e-mail verificado, alguém poderia criar conta em outro provedor com o e-mail
  // de um usuário nosso e cair na linha dele.
  if (d.email_verified !== "true" && (d.email_verified as unknown) !== true)
    throw new Error("e-mail não verificado no Google");
  if (!d.email || !d.sub) throw new Error("token sem e-mail");

  return { email: d.email, nome: d.name ?? null, sub: d.sub };
}
