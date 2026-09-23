// Produto embalado pelo código de barras, na base aberta do Open Food Facts.
//
// Para industrializado a tabela da embalagem vale mais que qualquer estimativa: o número
// vem de quem fabricou. A consulta passa pelo servidor porque a base pede um User-Agent
// que identifique o app, e navegador não deixa trocar esse cabeçalho.
import { Recusa } from "./validar.js";

export type Produto = {
  ean: string;
  nome: string;
  marca: string;
  unidade: "g" | "ml";                // a tabela é por 100 g ou por 100 ml
  por100: { kcal: number; p: number; c: number; g: number };
  porcao: number | null;              // porção da embalagem, em g ou ml
  embalagem: number | null;           // conteúdo total, em g ou ml
};

/** EAN-8, UPC-A (12), EAN-13 ou GTIN-14, com o dígito verificador conferido. */
export function eanValido(v: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(v)) return false;
  const d = [...v].map(Number), dv = d.pop()!;
  const soma = d.reverse().reduce((a, n, i) => a + n * (i % 2 ? 1 : 3), 0);
  return (10 - (soma % 10)) % 10 === dv;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// "2l", "1,5 L", "395 g", "1kg" → em g ou ml. A base às vezes omite product_quantity e
// só traz o texto da embalagem.
export function quantidadeDoTexto(t: unknown): number | null {
  const m = String(t || "").toLowerCase().replace(",", ".").match(/^\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/);
  if (!m) return null;
  const v = Number(m[1]) * (m[2] === "kg" || m[2] === "l" ? 1000 : 1);
  return v > 0 ? Math.round(v) : null;
}

export async function buscarProduto(ean: string): Promise<Produto | null> {
  if (!eanValido(ean)) throw new Recusa("código de barras inválido — confira os números");
  const campos = "product_name,product_name_pt,brands,nutriments,nutrition_data_per,serving_quantity,product_quantity,quantity";
  let r: Response;
  try {
    r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=${campos}`, {
      headers: { "User-Agent": "FiTe/1.0 (https://www.fite.app.br)" },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Recusa("a base de produtos não respondeu; tente de novo", 503);
  }
  if (r.status === 404) return null;
  if (!r.ok) throw new Recusa("a base de produtos não respondeu; tente de novo", 503);
  const d = await r.json() as { status?: number; product?: Record<string, unknown> };
  const p = d.product;
  if (d.status !== 1 || !p) return null;

  const n = (p.nutriments || {}) as Record<string, unknown>;
  // sem kcal por 100 não há o que multiplicar: para nós é produto sem tabela
  const kcal = num(n["energy-kcal_100g"]) ?? (num(n["energy_100g"]) !== null ? num(n["energy_100g"])! / 4.184 : null);
  if (kcal === null) return null;

  // nome vem de uma base pública e acaba em innerHTML na lista do dia
  const limpo = (v: unknown) => String(v || "").replace(/[<>]/g, "").trim();
  return {
    ean,
    nome: limpo(p.product_name_pt || p.product_name).slice(0, 150) || `Produto ${ean}`,
    marca: limpo(String(p.brands || "").split(",")[0]).slice(0, 60),
    unidade: String(p.nutrition_data_per || "").includes("ml") ? "ml" : "g",
    por100: {
      kcal,
      p: num(n.proteins_100g) ?? 0,
      c: num(n.carbohydrates_100g) ?? 0,
      g: num(n.fat_100g) ?? 0,
    },
    porcao: num(p.serving_quantity) || null,
    embalagem: num(p.product_quantity) || quantidadeDoTexto(p.quantity),
  };
}
