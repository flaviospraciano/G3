// Le a pagina oficial de taxas da Ton e atualiza data/taxas.json com protecoes.
// Uso: node src/scraper.js            (le a URL de TON_URL)
//      node src/scraper.js arquivo.html (le um HTML salvo, util para testar)
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const DATA = process.env.DATA_DIR || path.join(DIR, "..", "data");
export const ARQ = path.join(DATA, "taxas.json");
const TON_URL = process.env.TON_URL || "https://ton.com.br/planos-e-taxas";
const MAX_SALTO = Number(process.env.MAX_SALTO_PP || 5); // pontos percentuais por taxa em uma rodada

const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const pct = (s) => { const m = String(s).match(/(\d{1,2}(?:[.,]\d{1,2}))\s*%/) || String(s).match(/^\s*(\d{1,2}[.,]\d{1,2})\s*$/); return m ? parseFloat(m[1].replace(",", ".")) : null; };

/** Texto de cabecalho -> id da faixa (ou null). */
export function faixaDoTexto(t) {
  const n = norm(t);
  if (/promo/.test(n)) return "promo";
  if (/acima de (r\$ ?)?30/.test(n)) return "30k+";
  if (/(10|10\.000).{0,12}(a|ate).{0,6}(r\$ ?)?30/.test(n)) return "10k-30k";
  if (/(6|6\.000).{0,12}(a|ate).{0,6}(r\$ ?)?10/.test(n)) return "6k-10k";
  if (/(3|3\.000).{0,12}(a|ate).{0,6}(r\$ ?)?6/.test(n)) return "3k-6k";
  if (/^ate (r\$ ?)?3/.test(n) || /ate (r\$ ?)?3 ?(mil|\.000)/.test(n)) return "ate3k";
  return null;
}
/** Texto da linha -> chave da modalidade. */
function modalidade(t) {
  const n = norm(t);
  if (/debito/.test(n)) return "debito";
  const x = n.match(/(\d{1,2})\s*x/);
  if (x && +x[1] >= 2 && +x[1] <= 12) return x[1];
  if (/credito.*vista|a vista|^1\s*x/.test(n)) return "credito";
  return null;
}

/**
 * Extrai do HTML as taxas que conseguir. Retorna { faixaId: { "1du": {debito,credito,parcelas:{}}, na_hora: {...} } }.
 * Formato A: tabela "Modalidade | 1 dia util | Na hora" sob um titulo de faixa.
 * Formato B: tabela "Faturamento | Debito | Credito a vista | ... 12x" (uma linha por faixa).
 */
export function extrair(html) {
  const $ = cheerio.load(html), out = {};
  const put = (f, rec, k, v, p) => { if (v == null) return; const b = ((out[f] ??= {})[rec] ??= { debito: null, credito: null, parcelas: {} }); if (k === "debito" || k === "credito") b[k] = v; else b.parcelas[k] = v; };
  $("table").each((_, tb) => {
    const rows = $(tb).find("tr").map((__, tr) => [$(tr).find("th,td").map((___, c) => $(c).text().replace(/\s+/g, " ").trim()).get()]).get();
    if (rows.length < 2) return;
    const head = rows[0].map(norm);
    // contexto: titulo mais proximo antes da tabela
    let ctx = ""; let el = $(tb).prev(); for (let i = 0; i < 4 && el.length && !ctx; i++) { const t = el.text(); if (faixaDoTexto(t)) ctx = t; el = el.prev(); }
    if (!ctx) ctx = $(tb).parent().prevAll("h1,h2,h3,h4,p").first().text();
    const iDu = head.findIndex((h) => /1 dia/.test(h)), iNh = head.findIndex((h) => /na hora/.test(h));
    if (iDu > 0 || iNh > 0) { // formato A
      const f = faixaDoTexto(ctx); if (!f) return;
      rows.slice(1).forEach((r) => { const k = modalidade(r[0]); if (!k) return; if (iDu > 0) put(f, "1du", k, pct(r[iDu])); if (iNh > 0) put(f, "na_hora", k, pct(r[iNh])); });
      return;
    }
    if (/faturamento|faixa/.test(head[0] || "")) { // formato B
      const cols = head.map(modalidade);
      rows.slice(1).forEach((r) => { const f = faixaDoTexto(r[0]); if (!f) return; cols.forEach((k, i) => { if (k && i > 0) put(f, "1du", k, pct(r[i])); }); });
    }
  });
  return out;
}

/** Junta o extraido na tabela atual. Rejeita a rodada inteira se algum valor mudar mais que MAX_SALTO pontos. */
export function mesclar(atual, achado, { forcar = false } = {}) {
  const nova = structuredClone(atual), mudancas = [], suspeitos = [];
  const validos = new Set(nova.faixas.map((f) => f.id));
  for (const [f, recs] of Object.entries(achado)) {
    if (!validos.has(f)) continue;
    for (const [rec, b] of Object.entries(recs)) {
      const alvo = ((nova.taxas[f] ??= {}).visa_master ??= {})[rec] ??= { debito: null, credito: null, parcelas: {} };
      const set = (k, v, get, put) => {
        if (v == null) return;
        if (!(v > 0 && v < 40)) { suspeitos.push(`${f}/${rec}/${k}=${v} fora da faixa`); return; }
        const old = get(); if (old === v) return;
        if (old != null && Math.abs(old - v) > MAX_SALTO) suspeitos.push(`${f}/${rec}/${k}: ${old} -> ${v}`);
        put(v); mudancas.push(`${f}/${rec}/${k}: ${old ?? "vazio"} -> ${v}`);
      };
      set("debito", b.debito, () => alvo.debito, (v) => (alvo.debito = v));
      set("credito", b.credito, () => alvo.credito, (v) => (alvo.credito = v));
      for (const [p, v] of Object.entries(b.parcelas)) set(p + "x", v, () => alvo.parcelas?.[p] ?? null, (x) => ((alvo.parcelas ??= {})[p] = x));
    }
  }
  if (suspeitos.length && !forcar) { const e = new Error("Rodada rejeitada: " + suspeitos.join("; ")); e.suspeitos = suspeitos; throw e; }
  if (mudancas.length) nova.atualizadoEm = new Date().toISOString();
  return { nova, mudancas };
}

/** Baixa o HTML. BROWSER=1 usa Playwright (para paginas que carregam as taxas por JavaScript). */
export async function baixar(url = TON_URL) {
  if (process.env.BROWSER === "1") {
    const { chromium } = await import("playwright");
    const b = await chromium.launch(); const p = await b.newPage();
    await p.goto(url, { waitUntil: "networkidle", timeout: 60000 }); const h = await p.content(); await b.close(); return h;
  }
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; G3TaxasBot/1.0)", "accept-language": "pt-BR" }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error("HTTP " + r.status + " em " + url);
  return r.text();
}

export async function lerTabela() { return JSON.parse(await fs.readFile(ARQ, "utf8")); }
export async function salvarTabela(t, motivo = "scraper") {
  await fs.mkdir(path.join(DATA, "historico"), { recursive: true });
  const tmp = ARQ + ".tmp"; await fs.writeFile(tmp, JSON.stringify(t, null, 2)); await fs.rename(tmp, ARQ);
  await fs.writeFile(path.join(DATA, "historico", new Date().toISOString().replace(/[:.]/g, "-") + "-" + motivo + ".json"), JSON.stringify(t, null, 2));
}

/** Uma rodada completa. Nunca apaga dado bom: em caso de erro, mantem o arquivo atual. */
export async function rodar({ html, forcar = false } = {}) {
  const atual = await lerTabela();
  html ??= await baixar();
  const achado = extrair(html);
  if (!Object.keys(achado).length) throw new Error("Nenhuma tabela de taxas reconhecida na pagina (o layout pode ter mudado)");
  const { nova, mudancas } = mesclar(atual, achado, { forcar });
  if (mudancas.length) await salvarTabela(nova);
  return { mudancas, total: mudancas.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arq = process.argv[2];
  rodar({ html: arq ? await fs.readFile(arq, "utf8") : undefined, forcar: process.argv.includes("--forcar") })
    .then((r) => { console.log(r.total ? `OK: ${r.total} taxa(s) atualizada(s)` : "Sem mudancas"); r.mudancas.forEach((m) => console.log(" -", m)); })
    .catch((e) => { console.error("FALHOU:", e.message); process.exit(1); });
}
