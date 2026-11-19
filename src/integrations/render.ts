import type { BlockObjectRequest } from "@notionhq/client";
import type { Agenda } from "../agent/schema.js";

const PRIORIDADE: Record<string, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };

export function actionLine(a: Agenda["acoes"][number]): string {
  const parts = [a.descricao];
  const meta: string[] = [];
  if (a.responsavel) meta.push(`resp.: ${a.responsavel}`);
  if (a.prazo) meta.push(`prazo: ${a.prazo}`);
  meta.push(`prioridade ${PRIORIDADE[a.prioridade] ?? a.prioridade}`);
  if (a.origem === "sugerida") meta.push("sugerida pelo agente");
  return `${parts.join("")} (${meta.join(" · ")})`;
}

// ---------- Notion ----------

/** Notion limits each rich_text item to 2000 characters. */
function rt(text: string, bold = false) {
  const chunks = text.match(/[\s\S]{1,2000}/g) ?? [""];
  return chunks.map((c) => ({ type: "text" as const, text: { content: c }, annotations: { bold } }));
}

const h2 = (t: string): BlockObjectRequest => ({ type: "heading_2", heading_2: { rich_text: rt(t) } });
const h3 = (t: string): BlockObjectRequest => ({ type: "heading_3", heading_3: { rich_text: rt(t) } });
const p = (t: string): BlockObjectRequest => ({ type: "paragraph", paragraph: { rich_text: rt(t) } });
const li = (t: string): BlockObjectRequest => ({
  type: "bulleted_list_item",
  bulleted_list_item: { rich_text: rt(t) },
});
const todo = (t: string): BlockObjectRequest => ({ type: "to_do", to_do: { rich_text: rt(t), checked: false } });
const divider = (): BlockObjectRequest => ({ type: "divider", divider: {} });

export function agendaToNotionBlocks(a: Agenda, meta: { date: Date }): BlockObjectRequest[] {
  const blocks: BlockObjectRequest[] = [
    p(`Reunião de ${meta.date.toLocaleString("pt-BR")} · gerada pelo Agente de Pautas`),
  ];
  if (a.resumo) blocks.push(h2("Resumo"), p(a.resumo));

  blocks.push(h2("Tópicos discutidos"));
  if (a.topicos.length === 0) blocks.push(p("Nenhum tópico identificado ainda."));
  for (const t of a.topicos) {
    blocks.push(h3(`${t.titulo}${t.status === "concluido" ? " ✓" : ""}`));
    for (const pt of t.pontosDiscutidos) blocks.push(li(pt));
    for (const d of t.decisoes) blocks.push(li(`Decisão: ${d}`));
  }

  const section = (title: string, items: string[], make = li) => {
    if (items.length === 0) return;
    blocks.push(h2(title), ...items.map((i) => make(i)));
  };
  section("Insights", a.insights);
  section("Ações", a.acoes.map(actionLine), todo);
  section(
    "Ideias novas",
    a.ideiasNovas.map((i) => `${i.ideia} — ${i.justificativa}`),
  );
  section("Perguntas em aberto", a.perguntasEmAberto);
  blocks.push(divider());
  return blocks;
}

// ---------- HTML (Google Docs) ----------

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function agendaToHtml(a: Agenda, meta: { date: Date }): string {
  const list = (items: string[]) =>
    items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "";
  const section = (title: string, items: string[]) =>
    items.length ? `<h2>${esc(title)}</h2>${list(items)}` : "";

  const topics = a.topicos
    .map(
      (t) =>
        `<h3>${esc(t.titulo)}${t.status === "concluido" ? " ✓" : ""}</h3>` +
        list([...t.pontosDiscutidos, ...t.decisoes.map((d) => `Decisão: ${d}`)]),
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(a.titulo)}</title></head><body>
<h1>${esc(a.titulo)}</h1>
<p><i>Reunião de ${esc(meta.date.toLocaleString("pt-BR"))} · gerada pelo Agente de Pautas</i></p>
${a.resumo ? `<h2>Resumo</h2><p>${esc(a.resumo)}</p>` : ""}
<h2>Tópicos discutidos</h2>${topics || "<p>Nenhum tópico identificado ainda.</p>"}
${section("Insights", a.insights)}
${a.acoes.length ? `<h2>Ações</h2><ul>${a.acoes.map((x) => `<li>☐ ${esc(actionLine(x))}</li>`).join("")}</ul>` : ""}
${section("Ideias novas", a.ideiasNovas.map((i) => `${i.ideia} — ${i.justificativa}`))}
${section("Perguntas em aberto", a.perguntasEmAberto)}
</body></html>`;
}
