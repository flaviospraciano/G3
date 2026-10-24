// Calculo de taxas da maquininha. Sem dependencias: roda no navegador e no Node.
// Todas as taxas em PERCENTUAL (3.49 = 3,49%). Todos os valores em reais, com 2 casas.
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Quanto digitar na maquininha para o lojista RECEBER o liquido desejado (taxa repassada ao cliente).
 * cobrar = desejado / (1 - taxa), ajustado ao centavo: menor valor cujo liquido, arredondado em
 * centavos como a maquininha faz, nao fica abaixo do desejado.
 * @returns {{cobrar:number, taxaRetida:number, taxaPct:number, liquido:number}}
 */
export function calcularRepasse(desejado, taxaPct) {
  const t = Number(taxaPct) / 100;
  if (!(desejado > 0)) throw new RangeError("Valor desejado deve ser maior que zero");
  if (!(t >= 0 && t < 1)) throw new RangeError("Taxa invalida");
  const dc = Math.round(desejado * 100);
  const base = Math.round((desejado / (1 - t)) * 100);
  let k = null;
  for (let c = base - 3; c <= base + 3; c++) if (Math.round(c * (1 - t)) >= dc) { k = c; break; }
  if (k === null) k = Math.ceil((desejado / (1 - t)) * 100 - 1e-6);
  const cobrar = k / 100, liquido = Math.round(k * (1 - t)) / 100;
  return { cobrar, taxaRetida: r2(cobrar - liquido), taxaPct: Number(taxaPct), liquido };
}

/**
 * Taxa RETIDA quando o lojista digita um valor e NAO repassa a taxa.
 * @returns {{bruto:number, taxaRetida:number, liquido:number, taxaPct:number}}
 */
export function calcularRetida(bruto, taxaPct) {
  const t = Number(taxaPct) / 100;
  if (!(bruto > 0) || !(t >= 0 && t < 1)) throw new RangeError("Valores invalidos");
  const liquido = Math.round(Math.round(bruto * 100) * (1 - t)) / 100;
  return { bruto, taxaRetida: r2(bruto - liquido), liquido, taxaPct: Number(taxaPct) };
}

/** Descobre a faixa pelo faturamento mensal (R$). `promocional` usa a faixa promo. */
export function faixaPorFaturamento(tabela, faturamento, { promocional = false } = {}) {
  if (promocional) return "promo";
  const f = tabela.faixas.filter((x) => !x.promocional)
    .find((x) => faturamento >= x.min && (x.max == null || faturamento < x.max));
  return f ? f.id : null;
}

/** Taxa (%) da tabela. Lanca erro se ainda nao cadastrada (null). */
export function escolherTaxa(tabela, { faixa, bandeira = "visa_master", recebimento = "1du", modalidade = "credito", parcelas = 1 }) {
  const bloco = tabela?.taxas?.[faixa]?.[bandeira]?.[recebimento];
  if (!bloco) throw new Error(`Sem tabela para faixa=${faixa} bandeira=${bandeira} recebimento=${recebimento}`);
  const v = modalidade === "debito" ? bloco.debito : parcelas > 1 ? bloco.parcelas?.[String(parcelas)] : bloco.credito;
  if (v == null) throw new Error(`Taxa ainda nao cadastrada (${modalidade}${parcelas > 1 ? " " + parcelas + "x" : ""})`);
  return v;
}

/** O que falta para ter debito, credito e 2x..12x. */
export function faltantes(tabela, o) {
  const bloco = tabela?.taxas?.[o.faixa]?.[o.bandeira ?? "visa_master"]?.[o.recebimento ?? "1du"];
  if (!bloco) return ["tabela inteira"];
  const out = [];
  if (bloco.debito == null) out.push("debito");
  if (bloco.credito == null) out.push("credito");
  for (let p = 2; p <= 12; p++) if (bloco.parcelas?.[String(p)] == null) out.push(p + "x");
  return out;
}

/** Tabela de UMA faixa no formato que o app G3 le (ver exemplo-taxas.json). */
export function paraFormatoApp(tabela, o) {
  const faltam = faltantes(tabela, o);
  if (faltam.length) { const e = new Error("Tabela incompleta"); e.faltam = faltam; throw e; }
  const b = tabela.taxas[o.faixa][o.bandeira ?? "visa_master"][o.recebimento ?? "1du"];
  const faixa = tabela.faixas.find((x) => x.id === o.faixa);
  return {
    provider: tabela.plano || tabela.provider, brands: tabela.bandeiras[o.bandeira ?? "visa_master"],
    updatedAt: tabela.atualizadoEm, unit: "percent", faixa: { id: faixa.id, nome: faixa.nome },
    rates: { debit: b.debito, credit: b.credito, installments: b.parcelas },
  };
}
