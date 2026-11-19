import { z } from "zod";

export const TopicSchema = z.object({
  titulo: z.string().describe("Título curto do tópico discutido"),
  pontosDiscutidos: z.array(z.string()).describe("Principais pontos levantados sobre o tópico"),
  decisoes: z.array(z.string()).describe("Decisões tomadas sobre o tópico (vazio se nenhuma)"),
  status: z.enum(["em_discussao", "concluido"]),
});

export const ActionSchema = z.object({
  descricao: z.string(),
  responsavel: z.string().nullable().describe("Pessoa responsável, se mencionada"),
  prazo: z.string().nullable().describe("Prazo, se mencionado"),
  prioridade: z.enum(["alta", "media", "baixa"]),
  origem: z.enum(["discutida", "sugerida"]).describe(
    "'discutida' se foi combinada na reunião; 'sugerida' se é uma proposta do agente",
  ),
});

export const IdeaSchema = z.object({
  ideia: z.string(),
  justificativa: z.string().describe("Por que a ideia faz sentido, ligada ao que foi discutido"),
});

export const AgendaSchema = z.object({
  titulo: z.string(),
  resumo: z.string().describe("Resumo executivo em 2 a 4 frases"),
  topicos: z.array(TopicSchema),
  insights: z.array(z.string()),
  acoes: z.array(ActionSchema),
  ideiasNovas: z.array(IdeaSchema),
  perguntasEmAberto: z.array(z.string()),
});

export type Agenda = z.infer<typeof AgendaSchema>;
export type Topic = z.infer<typeof TopicSchema>;
export type Action = z.infer<typeof ActionSchema>;

export function emptyAgenda(titulo: string): Agenda {
  return {
    titulo,
    resumo: "",
    topicos: [],
    insights: [],
    acoes: [],
    ideiasNovas: [],
    perguntasEmAberto: [],
  };
}
