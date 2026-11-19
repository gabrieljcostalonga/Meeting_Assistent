import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agenda } from "../src/agent/schema.js";
import { actionLine, agendaToHtml, agendaToNotionBlocks } from "../src/integrations/render.js";

const agenda: Agenda = {
  titulo: "Planejamento <Q1>",
  resumo: "Data de lançamento definida.",
  topicos: [
    { titulo: "Lançamento", pontosDiscutidos: ["Bugs no Pix"], decisoes: ["Lançar em 22/03"], status: "concluido" },
  ],
  insights: ["Prazo depende do QA"],
  acoes: [
    { descricao: "Relatório de bugs", responsavel: "Marina", prazo: "sexta", prioridade: "alta", origem: "discutida" },
    { descricao: "Plano de suporte no fim de semana", responsavel: null, prazo: null, prioridade: "media", origem: "sugerida" },
  ],
  ideiasNovas: [{ ideia: "Programa de indicação", justificativa: "Baixo custo de aquisição" }],
  perguntasEmAberto: ["Haverá suporte no fim de semana?"],
};
const date = new Date("2026-03-01T10:00:00");

test("linha de ação inclui responsável, prazo, prioridade e origem", () => {
  assert.equal(actionLine(agenda.acoes[0]), "Relatório de bugs (resp.: Marina · prazo: sexta · prioridade Alta)");
  assert.match(actionLine(agenda.acoes[1]), /sugerida pelo agente/);
});

test("blocos do Notion têm seções, decisões e to-dos", () => {
  const blocks = agendaToNotionBlocks(agenda, { date });
  const types = blocks.map((b) => b.type);
  assert.ok(types.includes("heading_2"));
  assert.equal(types.filter((t) => t === "to_do").length, 2);
  const text = JSON.stringify(blocks);
  assert.match(text, /Decisão: Lançar em 22\/03/);
  assert.match(text, /Programa de indicação/);
});

test("texto longo é dividido em itens de até 2000 caracteres", () => {
  const long = { ...agenda, resumo: "x".repeat(4500) };
  const resumo = agendaToNotionBlocks(long, { date })[2] as { paragraph: { rich_text: unknown[] } };
  assert.equal(resumo.paragraph.rich_text.length, 3);
});

test("HTML escapa caracteres especiais e lista as seções", () => {
  const html = agendaToHtml(agenda, { date });
  assert.match(html, /Planejamento &lt;Q1&gt;/);
  assert.doesNotMatch(html, /<Q1>/);
  for (const s of ["Resumo", "Tópicos discutidos", "Insights", "Ações", "Ideias novas", "Perguntas em aberto"])
    assert.match(html, new RegExp(`<h2>${s}</h2>`));
});
