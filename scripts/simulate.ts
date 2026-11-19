/**
 * Simula uma reunião sem microfone: envia uma transcrição de exemplo em blocos
 * para o agente e mostra a pauta após cada atualização.
 *   npm run simulate
 */
import { AgendaAgent } from "../src/agent/agendaAgent.js";
import { AgendaSchema } from "../src/agent/schema.js";
import { resolveProvider } from "../src/llm/index.js";
import { Session } from "../src/session.js";

const BLOCOS = [
  "bom dia pessoal vamos começar a reunião de planejamento do lançamento do aplicativo de entregas a ideia hoje é fechar a data de lançamento e o orçamento de marketing",
  "a Marina comentou que o time de desenvolvimento ainda tem três bugs críticos no pagamento com pix e que precisa de pelo menos duas semanas para corrigir e testar",
  "o Carlos do marketing quer lançar no dia quinze de março porque coincide com uma campanha do shopping parceiro mas isso depende dos bugs estarem resolvidos",
  "ficou decidido que o lançamento vai ser no dia vinte e dois de março para dar folga para os testes e que a Marina vai mandar um relatório dos bugs até sexta-feira",
  "sobre o orçamento o Carlos pediu cinquenta mil reais para mídia paga mas a diretoria só aprovou trinta mil então precisamos priorizar os canais talvez instagram e parcerias com influenciadores locais",
  "alguém perguntou se a gente vai ter suporte ao cliente no fim de semana do lançamento ninguém soube responder e ficou de verificar com o time de operações",
  "o Carlos ainda sugeriu fazer um programa de indicação com cupom de desconto mas não definimos quem cuida disso nem o valor do cupom vamos retomar na próxima reunião",
];

const llm = resolveProvider();
console.log(llm.message);
if (!llm.provider) process.exit(1);

const session = new Session("Planejamento do lançamento", "notion", false);
const agent = new AgendaAgent(llm.provider, async () => {
  console.log("(exportação simulada — nenhum destino real usado)");
});

const t0 = Date.now();
for (const [i, b] of BLOCOS.entries()) {
  session.addChunk(b);
  // Atualiza a pauta a cada 3 blocos para exercitar a mesclagem incremental.
  if (i % 3 === 2) {
    await agent.runIncremental(session);
    if (session.lastError) console.error("ERRO:", session.lastError);
    console.log(`\n--- pauta após o bloco ${i + 1} (${((Date.now() - t0) / 1000).toFixed(0)}s) ---`);
    console.log(session.agenda.topicos.map((t) => `• ${t.titulo} [${t.status}]`).join("\n"));
  }
}
await agent.finish(session);
if (session.lastError) console.error("ERRO:", session.lastError);

const final = AgendaSchema.parse(session.agenda);
console.log("\n=== PAUTA FINAL ===");
console.log(JSON.stringify(final, null, 2));

const titles = final.topicos.map((t) => t.titulo.toLowerCase());
const dups = titles.filter((t, i) => titles.indexOf(t) !== i);
console.log(`\nTópicos: ${titles.length} · duplicados: ${dups.length} · ações: ${final.acoes.length} · ideias: ${final.ideiasNovas.length}`);
process.exit(session.lastError || dups.length ? 1 : 0);
