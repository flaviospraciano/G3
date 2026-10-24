import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "g3t-"));
fs.copyFileSync("data/taxas.json", path.join(tmp, "taxas.json"));
process.env.DATA_DIR = tmp;
const calc = await import("../src/taxas-calc.js");
const sc = await import("../src/scraper.js");
const { app } = await import("../src/server.js");
let n = 0; const ok = (nome, fn) => Promise.resolve(fn()).then(() => console.log("  ok  ", nome), (e) => { console.error("  FALHOU", nome, "\n", e.message); process.exitCode = 1; }).finally(() => n++);

console.log("# calculo");
await ok("exemplo: 100 a 3,49% => 103,62 / retida 3,62", () => { const r = calc.calcularRepasse(100, 3.49); assert.deepEqual([r.cobrar, r.taxaRetida, r.liquido], [103.62, 3.62, 100]); });
await ok("debito 1,99%: 102,03 (nao 102,04)", () => assert.equal(calc.calcularRepasse(100, 1.99).cobrar, 102.03));
await ok("liquido nunca abaixo do desejado e cobrar minimo (10000 casos)", () => { for (let i = 0; i < 10000; i++) { const v = Math.round((Math.random() * 5000 + 1) * 100) / 100, p = Math.round(Math.random() * 2500) / 100 + 0.5; const r = calc.calcularRepasse(v, p), k = Math.round(r.cobrar * 100); assert.ok(Math.round(k * (1 - p / 100)) >= Math.round(v * 100)); assert.ok(Math.round((k - 1) * (1 - p / 100)) < Math.round(v * 100)); } });
await ok("retida: 100 a 3,49% => 3,49 / 96,51", () => { const r = calc.calcularRetida(100, 3.49); assert.deepEqual([r.taxaRetida, r.liquido], [3.49, 96.51]); });
await ok("entradas invalidas", () => { assert.throws(() => calc.calcularRepasse(0, 3)); assert.throws(() => calc.calcularRepasse(10, 100)); });
const t0 = JSON.parse(fs.readFileSync("data/taxas.json", "utf8"));
await ok("faixa por faturamento", () => { assert.equal(calc.faixaPorFaturamento(t0, 2999), "ate3k"); assert.equal(calc.faixaPorFaturamento(t0, 3000), "3k-6k"); assert.equal(calc.faixaPorFaturamento(t0, 45000), "30k+"); assert.equal(calc.faixaPorFaturamento(t0, 10, { promocional: true }), "promo"); });
await ok("escolherTaxa e taxa nao cadastrada", () => { assert.equal(calc.escolherTaxa(t0, { faixa: "ate3k", modalidade: "debito" }), 1.69); assert.equal(calc.escolherTaxa(t0, { faixa: "ate3k", parcelas: 12 }), 20.39); assert.throws(() => calc.escolherTaxa(t0, { faixa: "ate3k", parcelas: 8 }), /nao cadastrada/); });
await ok("seed: so 'promo' esta completa", () => { assert.deepEqual(calc.faltantes(t0, { faixa: "promo" }), []); assert.ok(calc.faltantes(t0, { faixa: "3k-6k" }).length > 5); });

console.log("# scraper");
const A = `<h2>Ate R$ 3 mil</h2><table><tr><th>Modalidade</th><th>1 dia util</th><th>Na hora</th></tr>
<tr><td>Debito</td><td>1,69%</td><td>1,98%</td></tr><tr><td>Credito a vista</td><td>3,86%</td><td>4,86%</td></tr>
${[2,3,4,5,6,7,8,9,10,11,12].map((p,i)=>`<tr><td>Parcelado em ${p}x</td><td>${(9.86+i*1.1).toFixed(2).replace(".",",")}%</td><td>${(10.86+i*1.1).toFixed(2).replace(".",",")}%</td></tr>`).join("")}</table>`;
const B = `<table><tr><th>Faturamento mensal</th><th>Debito</th><th>Credito a vista</th><th>Credito 6x</th><th>Credito 12x</th></tr>
<tr><td>De R$ 3 mil a R$ 6 mil</td><td>1,39%</td><td>3,34%</td><td>10,85%</td><td>12,38%</td></tr>
<tr><td>Acima de R$ 30 mil</td><td>1,19%</td><td>2,85%</td><td>9,22%</td><td>11,51%</td></tr></table>`;
await ok("formato A (modalidade x prazo)", () => { const x = sc.extrair(A); assert.equal(x.ate3k["1du"].debito, 1.69); assert.equal(x.ate3k.na_hora.credito, 4.86); assert.equal(Object.keys(x.ate3k["1du"].parcelas).length, 11); });
await ok("formato B (uma linha por faixa)", () => { const x = sc.extrair(B); assert.equal(x["3k-6k"]["1du"].parcelas["12"], 12.38); assert.equal(x["30k+"]["1du"].credito, 2.85); });
await ok("mesclar preenche os null e registra mudancas", () => { const { nova, mudancas } = sc.mesclar(t0, sc.extrair(A)); assert.equal(nova.taxas.ate3k.visa_master["1du"].parcelas["8"], 9.86 + 6 * 1.1 > 0 ? Number((9.86 + 6 * 1.1).toFixed(2)) : 0); assert.ok(mudancas.length > 5); assert.ok(nova.atualizadoEm); assert.equal(calc.faltantes(nova, { faixa: "ate3k" }).length, 0); });
await ok("protecao: salto absurdo rejeita a rodada", () => { const ruim = A.replace("1,69%", "9,69%"); assert.throws(() => sc.mesclar(t0, sc.extrair(ruim)), /rejeitada/); });
await ok("protecao: valor fora de faixa (0% ou 80%)", () => { assert.throws(() => sc.mesclar(t0, sc.extrair(A.replace("3,86%", "86,00%"))), /fora da faixa/); });
await ok("pagina sem tabela => erro e arquivo intacto", async () => { const antes = fs.readFileSync(path.join(tmp, "taxas.json"), "utf8"); await assert.rejects(sc.rodar({ html: "<html><body>JS only</body></html>" }), /Nenhuma tabela/); assert.equal(fs.readFileSync(path.join(tmp, "taxas.json"), "utf8"), antes); });

console.log("# endpoints");
const srv = app.listen(0); const base = "http://127.0.0.1:" + srv.address().port;
const get = async (u) => { const r = await fetch(base + u); return [r.status, await r.json()]; };
await ok("GET /api/taxas faixa incompleta => 409 com 'faltam'", async () => { const [s, j] = await get("/api/taxas?faixa=3k-6k"); assert.equal(s, 409); assert.ok(j.faltam.includes("2x")); });
await ok("GET /api/taxas faixa promo => formato do app", async () => { const [s, j] = await get("/api/taxas?faixa=promo"); assert.equal(s, 200); assert.equal(j.rates.credit, 0.57); assert.equal(Object.keys(j.rates.installments).length, 11); });
await sc.rodar({ html: A + B });
await ok("depois do scraper, faixa ate3k completa e entregue", async () => { const [s, j] = await get("/api/taxas?faixa=ate3k"); assert.equal(s, 200); assert.equal(j.rates.debit, 1.69); assert.equal(j.rates.installments["12"], Number((9.86 + 10 * 1.1).toFixed(2))); });
await ok("GET /api/taxas/faixa?faturamento=4200", async () => { const [, j] = await get("/api/taxas/faixa?faturamento=4200"); assert.equal(j.faixa, "3k-6k"); });
await ok("admin sem token => 401", async () => { const r = await fetch(base + "/api/admin/taxas", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); assert.equal(r.status, 401); });
await ok("historico gravado", () => assert.ok(fs.readdirSync(path.join(tmp, "historico")).length >= 1));
await ok("resposta casa com o normalizador do app (13 taxas, unit percent)", async () => { const [, j] = await get("/api/taxas?faixa=promo"); const nums = [j.rates.debit, j.rates.credit, ...Object.values(j.rates.installments)]; assert.equal(nums.length, 13); assert.ok(nums.every((v) => v > 0 && v < 50)); assert.equal(j.unit, "percent"); });
srv.close(); console.log(`\n${n} testes executados`);
