// Agente de Pautas — front-end (sem build, JavaScript puro)
const $ = (id) => document.getElementById(id);

let status = null;
let destination = null;
let session = null;
let events = null;

// ---------------- utilidades ----------------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

function toast(msg, ms = 4000) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c instanceof Node ? c : String(c));
  return e;
};

// ---------------- Tela 1: status, destino e conexões ----------------

async function loadStatus() {
  status = await api("/api/status");

  const llm = $("llm-status");
  llm.textContent = status.llm.available ? status.llm.message : `⚠️ ${status.llm.message}`;
  llm.className = `pill ${status.llm.available ? "ok" : "bad"}`;

  // Notion
  const n = status.notion;
  $("notion-badge").textContent = n.connected ? `Conectado${n.workspaceName ? ` · ${n.workspaceName}` : ""}` : "Desconectado";
  $("notion-badge").classList.toggle("ok", n.connected);
  $("notion-connect").hidden = n.connected;
  $("notion-target").hidden = !n.connected;
  $("notion-oauth").hidden = !n.oauthAvailable;
  $("notion-internal").open = !n.oauthAvailable;
  if (n.connected) loadNotionPages();

  // Google
  const g = status.google;
  $("google-badge").textContent = g.connected ? `Conectado${g.email ? ` · ${g.email}` : ""}` : "Desconectado";
  $("google-badge").classList.toggle("ok", g.connected);
  $("google-connect").hidden = g.connected;
  $("google-target").hidden = !g.connected;
  $("google-oauth").hidden = !g.oauthAvailable;
  $("google-missing").hidden = g.oauthAvailable;
  if (g.connected) loadGoogleFolders();

  selectDestination(destination || status.preferredDestination, false);
}

function selectDestination(dest, persist = true) {
  destination = dest;
  document.querySelectorAll(".dest-card").forEach((c) => c.classList.toggle("selected", c.dataset.dest === dest));
  if (persist && dest) api("/api/destination", { method: "POST", body: { destination: dest } }).catch(() => {});
  refreshStartButton();
}

function refreshStartButton() {
  let reason = "";
  if (!status?.llm.available) reason = "Configure o acesso ao Claude (veja o aviso no topo).";
  else if (!destination) reason = "Escolha onde salvar as pautas.";
  else if (destination === "notion" && !status.notion.connected) reason = "Conecte o Notion.";
  else if (destination === "notion" && !status.notion.parentPage) reason = "Escolha a página do Notion.";
  else if (destination === "drive" && !status.google.connected) reason = "Conecte o Google Drive.";
  else if (destination === "drive" && !status.google.folder) reason = "Escolha ou crie uma pasta no Drive.";
  $("start-btn").disabled = Boolean(reason);
  $("start-hint").textContent = reason;
}

async function loadNotionPages() {
  const sel = $("notion-pages");
  sel.innerHTML = "<option>Carregando…</option>";
  try {
    const pages = await api("/api/notion/pages");
    sel.innerHTML = "";
    sel.append(el("option", { value: "" }, pages.length ? "Selecione uma página…" : "Nenhuma página compartilhada com a integração"));
    for (const p of pages) sel.append(el("option", { value: p.id }, p.title));
    if (status.notion.parentPage) sel.value = status.notion.parentPage.id;
  } catch (e) {
    sel.innerHTML = "";
    sel.append(el("option", { value: "" }, `Erro: ${e.message}`));
  }
}

async function loadGoogleFolders() {
  const sel = $("google-folders");
  sel.innerHTML = "<option>Carregando…</option>";
  try {
    const folders = await api("/api/google/folders");
    sel.innerHTML = "";
    sel.append(el("option", { value: "" }, folders.length ? "Selecione uma pasta…" : "Nenhuma pasta — clique em “Nova pasta”"));
    for (const f of folders) sel.append(el("option", { value: f.id }, f.name));
    if (status.google.folder) sel.value = status.google.folder.id;
  } catch (e) {
    sel.innerHTML = "";
    sel.append(el("option", { value: "" }, `Erro: ${e.message}`));
  }
}

document.querySelectorAll("[data-choose]").forEach((b) =>
  b.addEventListener("click", () => selectDestination(b.dataset.choose)),
);

$("notion-token-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/notion/token", { method: "POST", body: { token: $("notion-token").value } });
    $("notion-token").value = "";
    toast("Notion conectado!");
    selectDestination("notion");
    await loadStatus();
  } catch (err) {
    toast(err.message);
  }
});

$("notion-pages").addEventListener("change", async (e) => {
  const opt = e.target.selectedOptions[0];
  if (!opt.value) return;
  await api("/api/notion/parent", { method: "POST", body: { id: opt.value, title: opt.textContent } });
  status.notion.parentPage = { id: opt.value, title: opt.textContent };
  refreshStartButton();
});
$("notion-refresh").addEventListener("click", loadNotionPages);
$("notion-disconnect").addEventListener("click", async () => {
  await api("/api/notion/disconnect", { method: "POST" });
  loadStatus();
});

$("google-folders").addEventListener("change", async (e) => {
  const opt = e.target.selectedOptions[0];
  if (!opt.value) return;
  await api("/api/google/folder", { method: "POST", body: { id: opt.value, name: opt.textContent } });
  status.google.folder = { id: opt.value, name: opt.textContent };
  refreshStartButton();
});
$("google-new-folder").addEventListener("click", async () => {
  const name = prompt("Nome da nova pasta no Google Drive:", "Pautas de Reunião");
  if (!name) return;
  try {
    const f = await api("/api/google/folders", { method: "POST", body: { name } });
    status.google.folder = f;
    await loadGoogleFolders();
    refreshStartButton();
  } catch (err) {
    toast(err.message);
  }
});
$("google-disconnect").addEventListener("click", async () => {
  await api("/api/google/disconnect", { method: "POST" });
  loadStatus();
});

// ---------------- Tela 2: reunião ----------------

$("start-btn").addEventListener("click", async () => {
  try {
    session = await api("/api/sessions", {
      method: "POST",
      body: { title: $("meeting-title").value.trim(), destination, liveSync: $("live-sync").checked },
    });
  } catch (e) {
    return toast(e.message);
  }
  $("setup-view").hidden = true;
  $("meeting-view").hidden = false;
  $("m-title").textContent = session.title;
  $("m-sub").textContent = `Salvando em ${destination === "notion" ? `Notion → ${status.notion.parentPage?.title}` : `Google Drive → ${status.google.folder?.name}`}`;
  $("live-sync-2").checked = session.liveSync;
  events = new EventSource(`/api/sessions/${session.id}/events`);
  events.addEventListener("state", (e) => renderState(JSON.parse(e.data)));
  startRecognition();
});

function renderState(s) {
  session = s;
  $("upd-state").hidden = !s.updating;
  $("upd-state").textContent = s.status === "finalizando" ? "Consolidando a pauta final…" : "Atualizando pauta…";
  $("err").hidden = !s.lastError;
  $("err").textContent = s.lastError || "";
  if (s.exportRef) {
    $("doc-link").hidden = false;
    $("doc-link").href = s.exportRef.url;
  }
  if (s.status !== "gravando") {
    $("finish-btn").disabled = true;
    $("update-btn").disabled = true;
    $("mic-btn").disabled = true;
  }
  if (s.status === "finalizada") {
    stopRecognition();
    $("rec-state").textContent = "Reunião encerrada";
    $("rec-state").className = "pill ok";
    if (s.exportRef) toast("Pauta final salva! Use “Abrir documento”.", 8000);
    events?.close();
  }
  renderAgenda(s.agenda);
}

function renderAgenda(a) {
  const root = $("agenda");
  root.innerHTML = "";
  const nothing =
    !a.resumo && !a.topicos.length && !a.insights.length && !a.acoes.length && !a.ideiasNovas.length;
  if (nothing) {
    root.append(el("p", { class: "empty" }, "A pauta aparece aqui depois das primeiras falas (atualiza a cada ~300 palavras ou a cada ciclo de tempo)."));
    return;
  }
  if (a.titulo) $("m-title").textContent = a.titulo;
  if (a.resumo) root.append(el("h3", {}, "Resumo"), el("p", {}, a.resumo));

  if (a.topicos.length) {
    root.append(el("h3", {}, "Tópicos"));
    for (const t of a.topicos) {
      root.append(
        el("div", { class: `topic ${t.status === "concluido" ? "done" : ""}` },
          el("h4", {}, t.titulo, el("span", { class: "tag" }, t.status === "concluido" ? "concluído" : "em discussão")),
          el("ul", {},
            t.pontosDiscutidos.map((p) => el("li", {}, p)),
            t.decisoes.map((d) => el("li", { class: "decision" }, `Decisão: ${d}`)),
          ),
        ),
      );
    }
  }
  const list = (title, items) => {
    if (!items.length) return;
    root.append(el("h3", {}, title), el("ul", {}, items));
  };
  list("Insights", a.insights.map((i) => el("li", {}, i)));
  list("Ações", a.acoes.map((x) =>
    el("li", {}, x.descricao,
      x.responsavel ? el("span", { class: "tag" }, `👤 ${x.responsavel}`) : null,
      x.prazo ? el("span", { class: "tag" }, `📅 ${x.prazo}`) : null,
      el("span", { class: `tag ${x.prioridade}` }, x.prioridade === "media" ? "média" : x.prioridade),
      x.origem === "sugerida" ? el("span", { class: "tag" }, "💡 sugerida") : null,
    ),
  ));
  list("Ideias novas", a.ideiasNovas.map((i) => el("li", {}, el("b", {}, i.ideia), ` — ${i.justificativa}`)));
  list("Perguntas em aberto", a.perguntasEmAberto.map((q) => el("li", {}, q)));
}

$("update-btn").addEventListener("click", () => api(`/api/sessions/${session.id}/update`, { method: "POST" }));
$("live-sync-2").addEventListener("change", (e) =>
  api(`/api/sessions/${session.id}/settings`, { method: "POST", body: { liveSync: e.target.checked } }),
);
$("finish-btn").addEventListener("click", async () => {
  if (!confirm("Encerrar a reunião e salvar a pauta final?")) return;
  stopRecognition();
  $("finish-btn").disabled = true;
  try {
    await api(`/api/sessions/${session.id}/finish`, { method: "POST" });
  } catch (e) {
    toast(e.message);
  }
});

// ---------------- Reconhecimento de voz (Web Speech API) ----------------

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let wantRecording = false;
const startedAt = Date.now();

function stamp() {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function addFinal(text) {
  const box = $("transcript");
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  box.append(el("p", {}, el("time", {}, stamp()), text));
  if (atBottom) box.scrollTop = box.scrollHeight;
  fetch(`/api/sessions/${session.id}/transcript`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch(() => toast("Falha ao enviar trecho ao servidor"));
}

function setRec(on) {
  $("rec-state").textContent = on ? "Ouvindo…" : "Microfone desligado";
  $("rec-state").className = `pill ${on ? "live" : ""}`;
  $("mic-btn").textContent = on ? "⏸️ Pausar captura" : "🎙️ Iniciar captura";
}

function startRecognition() {
  if (!SpeechRecognition) {
    $("err").hidden = false;
    $("err").textContent =
      "Este navegador não tem reconhecimento de voz. Use o Google Chrome ou o Microsoft Edge.";
    $("mic-btn").disabled = true;
    return;
  }
  wantRecording = true;
  if (!recognition) {
    recognition = new SpeechRecognition();
    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) addFinal(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      $("interim").textContent = interim;
    };
    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantRecording = false;
        toast("Permissão de microfone negada. Libere o microfone no navegador.");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        console.warn("speech error", e.error);
      }
    };
    // O Chrome encerra o reconhecimento periodicamente: reinicia enquanto a captura estiver ligada.
    recognition.onend = () => {
      if (wantRecording) setTimeout(() => { try { recognition.start(); } catch {} }, 250);
      else setRec(false);
    };
  }
  try { recognition.start(); } catch {}
  setRec(true);
}

function stopRecognition() {
  wantRecording = false;
  try { recognition?.stop(); } catch {}
  $("interim").textContent = "";
  setRec(false);
}

$("mic-btn").addEventListener("click", () => (wantRecording ? stopRecognition() : startRecognition()));

// ---------------- início ----------------

const params = new URLSearchParams(location.search);
if (params.get("msg")) {
  toast(params.get("msg"));
  history.replaceState(null, "", "/");
}
loadStatus().catch((e) => toast(e.message));

// Ao clicar em "Conectar", já marca o destino escolhido (volta selecionado após o OAuth).
$("notion-oauth").addEventListener("click", () => selectDestination("notion"));
$("google-oauth").addEventListener("click", () => selectDestination("drive"));
