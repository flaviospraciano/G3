// API leve de taxas para o app G3. Node >= 18.
//   GET  /api/taxas?faixa=3k-6k&bandeira=visa_master&recebimento=1du  -> formato lido pelo app (rates.debit/credit/installments)
//   GET  /api/taxas/completa                                          -> tabela inteira (todas as faixas)
//   GET  /api/taxas/faixa?faturamento=4200[&promocional=1]            -> qual faixa se aplica
//   POST /api/admin/taxas  (Authorization: Bearer ADMIN_TOKEN)        -> substitui a tabela (plano B manual)
//   POST /api/admin/atualizar (Bearer)                                -> roda o scraper agora
//   GET  /health
import express from "express";
import cron from "node-cron";
import { lerTabela, salvarTabela, rodar } from "./scraper.js";
import { paraFormatoApp, faixaPorFaturamento } from "./taxas-calc.js";

const PORT = process.env.PORT || 3000;
const ADMIN = process.env.ADMIN_TOKEN || "";
const ORIGENS = (process.env.CORS_ORIGINS || "*").split(",").map((s) => s.trim());
const FAIXA_PADRAO = process.env.FAIXA_PADRAO || "ate3k";
const ultimo = { quando: null, ok: null, msg: "" };

export const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (ORIGENS.includes("*") || (o && ORIGENS.includes(o))) res.set("Access-Control-Allow-Origin", ORIGENS.includes("*") ? "*" : o);
  res.set({ "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Cache-Control": "public, max-age=300" });
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
const admin = (req, res, next) => (ADMIN && req.headers.authorization === "Bearer " + ADMIN ? next() : res.status(401).json({ erro: "nao autorizado" }));

app.get("/health", async (_q, res) => { const t = await lerTabela(); res.json({ ok: true, atualizadoEm: t.atualizadoEm, ultimaRodada: ultimo }); });

app.get("/api/taxas", async (req, res) => {
  const t = await lerTabela();
  const o = { faixa: req.query.faixa || FAIXA_PADRAO, bandeira: req.query.bandeira || "visa_master", recebimento: req.query.recebimento || "1du" };
  try { res.json(paraFormatoApp(t, o)); }
  catch (e) { res.status(e.faltam ? 409 : 404).json({ erro: e.message, ...o, faltam: e.faltam }); } // 409: o app cai para a ultima tabela salva
});
app.get("/api/taxas/completa", async (_q, res) => res.json(await lerTabela()));
app.get("/api/taxas/faixa", async (req, res) => {
  const t = await lerTabela(), f = faixaPorFaturamento(t, Number(req.query.faturamento) || 0, { promocional: req.query.promocional === "1" });
  res.json({ faixa: f, nome: t.faixas.find((x) => x.id === f)?.nome ?? null });
});
app.post("/api/admin/taxas", admin, async (req, res) => {
  const t = req.body; if (!t?.faixas || !t?.taxas) return res.status(400).json({ erro: "JSON invalido" });
  t.atualizadoEm = new Date().toISOString(); await salvarTabela(t, "manual"); res.json({ ok: true });
});
app.post("/api/admin/atualizar", admin, async (_q, res) => { try { res.json(await executar()); } catch (e) { res.status(502).json({ erro: e.message }); } });

async function executar() {
  try { const r = await rodar(); Object.assign(ultimo, { quando: new Date().toISOString(), ok: true, msg: `${r.total} mudanca(s)` }); return r; }
  catch (e) { Object.assign(ultimo, { quando: new Date().toISOString(), ok: false, msg: e.message }); console.error("[scraper]", e.message); throw e; }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  // todo dia as 06:00 e 14:00 (horario de Fortaleza); ajuste CRON se quiser
  cron.schedule(process.env.CRON || "0 6,14 * * *", () => executar().catch(() => {}), { timezone: "America/Fortaleza" });
  app.listen(PORT, () => console.log("Taxas G3 na porta", PORT));
}
