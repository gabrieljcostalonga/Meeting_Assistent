# Meeting_Assistent — Agente de Pautas de Reunião

Agente de IA que **escuta uma reunião**, monta a **pauta ao vivo** com os principais tópicos, **extrai insights** e **propõe ações e ideias novas**. Ao final (ou durante a reunião), salva tudo no **Notion** ou no **Google Drive**, conforme você escolher.

- Transcrição: reconhecimento de voz do próprio navegador (Chrome/Edge, pt-BR). Gratuito e em tempo real.
- Inteligência: Claude, pela **chave da API Anthropic** ou pelo **Claude Code CLI** logado na sua conta (Pro/Max).
- Destinos: **Notion** (uma página por reunião) ou **Google Drive** (um Google Doc por reunião).

## Requisitos

- Node.js 20 ou mais recente
- Google Chrome ou Microsoft Edge (o reconhecimento de voz não funciona no Firefox/Safari)
- Uma destas formas de acesso ao Claude:
  - **Claude Code CLI** instalado e logado: rode `claude` e use `/login` com a sua conta; ou
  - **Chave da API** em [console.anthropic.com](https://console.anthropic.com) (cobrança à parte do plano Pro).

## Instalação

```bash
npm install
cp .env.example .env
npm run build
npm start
```

Abra **http://localhost:3000** no Chrome. Para desenvolvimento com recarga automática: `npm run dev`.

## Como o app acessa o Claude

O modo é escolhido **ao iniciar o servidor, em cada computador**, e aparece no topo da tela:

| `LLM_MODE` | Comportamento |
|---|---|
| `auto` (padrão) | Usa `ANTHROPIC_API_KEY` se estiver definida; senão, o comando `claude` deste computador |
| `api` | Só a chave da API (modelo `ANTHROPIC_MODEL`, padrão `claude-opus-5-5`) |
| `cli` | Só o Claude Code CLI (modelo `CLAUDE_CLI_MODEL`, padrão `sonnet`) |

No modo CLI a pauta é atualizada no máximo a cada ~90 s, porque o CLI é mais lento e consome os limites de uso do plano. Se o CLI responder que o modelo exige créditos, ajuste `CLAUDE_CLI_MODEL` (por exemplo `sonnet`).

## Conectando os destinos

O app pergunta onde salvar e pede o acesso pela própria interface. As credenciais ficam só neste computador, em `data/tokens.json` (fora do git).

### Notion: opção simples (token de integração)

1. Acesse [notion.so/profile/integrations](https://www.notion.so/profile/integrations) → **Nova integração** → tipo **Interna**.
2. Copie o *Internal Integration Secret* e cole no app (cartão Notion → "Conectar com token de integração").
3. No Notion, abra a página onde quer as pautas → **⋯ → Conexões** → adicione a sua integração.
4. No app, escolha essa página na lista. Cada reunião vira uma subpágina dela.

### Notion: opção OAuth (botão "Conectar com o Notion")

1. Em [notion.so/profile/integrations](https://www.notion.so/profile/integrations), crie uma integração **Pública**.
2. Redirect URI: `http://localhost:3000/auth/notion/callback`
3. Preencha `NOTION_CLIENT_ID` e `NOTION_CLIENT_SECRET` no `.env` e reinicie.
4. Na tela de autorização do Notion, selecione as páginas que o app pode usar.

### Google Drive (OAuth)

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto e ative a **Google Drive API**.
2. Em **APIs e serviços → Tela de consentimento OAuth**, configure o app (tipo "Externo") e adicione o seu e-mail como usuário de teste.
3. Em **Credenciais → Criar credenciais → ID do cliente OAuth** → tipo **Aplicativo da Web**.
   Redirect URI autorizado: `http://localhost:3000/auth/google/callback`
4. Preencha `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env` e reinicie.
5. No app, clique em **Conectar com o Google** e depois em **Nova pasta** (ex.: "Pautas de Reunião").

O app usa o escopo `drive.file`: ele só enxerga os arquivos e pastas que ele mesmo criou. Por isso a lista de pastas mostra apenas as criadas pelo app.

> Se usar outra porta, troque `3000` nas Redirect URIs e defina `PORT` no `.env`.

## Usando numa reunião

1. Escolha o destino, dê um nome à reunião e clique em **Começar reunião**.
2. Clique em **Iniciar captura** e permita o microfone.
3. A transcrição aparece à esquerda e a pauta à direita. A pauta é atualizada a cada ~300 palavras novas ou a cada ciclo de tempo, e o botão **Atualizar pauta agora** força uma atualização.
4. Com **Sincronizar ao vivo** ligado, o documento no Notion/Drive é atualizado a cada nova versão da pauta.
5. **Encerrar e salvar** faz uma revisão final com a transcrição completa e grava a pauta consolidada.

**Reuniões online (Meet, Zoom, Teams):** o reconhecimento capta o **microfone**. Para captar as outras pessoas, deixe o som saindo pelos alto-falantes (sem fone) ou use um dispositivo de áudio virtual/loopback (ex.: VB-Cable no Windows, BlackHole no macOS) como microfone.

## Como o agente funciona

- O navegador envia ao servidor só os trechos **finais** do reconhecimento.
- A cada ciclo, o Claude recebe a **pauta atual + apenas o trecho novo** e devolve a pauta completa atualizada, num formato estruturado e validado (tópicos com pontos e decisões, insights, ações com responsável/prazo/prioridade, ideias novas e perguntas em aberto). Assim cada chamada continua pequena mesmo em reuniões longas.
- As ações são marcadas como **discutidas** (combinadas na reunião) ou **sugeridas** (propostas pelo agente).
- Ao encerrar, uma **passada final** com a transcrição completa consolida a pauta.

## Testes

```bash
npm test          # testes da conversão da pauta para Notion e HTML
npm run simulate  # simula uma reunião sem microfone usando o Claude configurado
```

## Rodando em outro computador

Clone este repositório (`git clone https://github.com/gabrieljcostalonga/Meeting_Assistent.git`), rode `npm install`, crie o `.env` e reconecte o Notion/Drive pela interface. O modo de acesso ao Claude é detectado de novo naquela máquina. Se ela tiver o `claude` logado e nenhuma `ANTHROPIC_API_KEY`, o app usa o CLI automaticamente.

## Estrutura

```
src/
  server.ts               rotas HTTP, OAuth, SSE
  agent/                  schema da pauta, prompt e ciclo incremental do agente
  llm/                    acesso ao Claude: API (anthropic.ts) ou CLI (claudeCli.ts)
  integrations/           Notion, Google Drive, tokens e renderização
public/                   interface web (HTML/CSS/JS)
scripts/                  simulação e testes
```
