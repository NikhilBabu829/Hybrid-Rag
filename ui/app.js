/* ============================================================
   Production-Grade RAG — front-end only.

   Nothing here talks to Mongo or Anthropic. When your FastAPI
   endpoint exists, flip USE_MOCK to false and point API_URL at
   it. The expected response shape is documented on askBackend().
   ============================================================ */

const USE_MOCK = false;
const API_URL = "http://127.0.0.1:8000/api/chat";

/* ── elements ─────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const els = {
  messages: $("messages"),
  emptyState: $("emptyState"),
  composer: $("composer"),
  input: $("input"),
  send: $("send"),
  sources: $("sources"),
  sourcesList: $("sourcesList"),
  sourcesMeta: $("sourcesMeta"),
  sidebar: $("sidebar"),
  scrim: $("scrim"),
  mode: $("mode"),
  topK: $("topK"),
  topKValue: $("topKValue"),
  rrfK: $("rrfK"),
  rrfKValue: $("rrfKValue"),
  showSources: $("showSources"),
};

let busy = false;

/* ── settings ─────────────────────────────────────────────── */
els.topK.addEventListener("input", () => (els.topKValue.textContent = els.topK.value));
els.rrfK.addEventListener("input", () => (els.rrfKValue.textContent = els.rrfK.value));
els.showSources.addEventListener("change", () => {
  els.sources.style.display = els.showSources.checked ? "" : "none";
});

/* ── theme ────────────────────────────────────────────────── */
const root = document.documentElement;
const savedTheme = (() => {
  try { return localStorage.getItem("rag-theme"); } catch { return null; }
})();
if (savedTheme) root.dataset.theme = savedTheme;

$("themeToggle").addEventListener("click", () => {
  const next = root.dataset.theme === "light" ? "dark" : "light";
  root.dataset.theme = next;
  try { localStorage.setItem("rag-theme", next); } catch { /* private mode */ }
});

/* ── drawers (mobile / narrow) ────────────────────────────── */
function openDrawer(el) {
  el.classList.add("is-open");
  els.scrim.hidden = false;
}
function closeDrawers() {
  els.sidebar.classList.remove("is-open");
  els.sources.classList.remove("is-open");
  els.scrim.hidden = true;
}

$("menuBtn").addEventListener("click", () => openDrawer(els.sidebar));
$("sidebarClose").addEventListener("click", closeDrawers);
$("sourcesClose").addEventListener("click", closeDrawers);
els.scrim.addEventListener("click", closeDrawers);
document.addEventListener("keydown", (e) => e.key === "Escape" && closeDrawers());

/* ── composer ─────────────────────────────────────────────── */
function autogrow() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 180) + "px";
  els.send.disabled = busy || els.input.value.trim() === "";
}
els.input.addEventListener("input", autogrow);
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});
autogrow();

els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = els.input.value.trim();
  if (!q || busy) return;
  els.input.value = "";
  autogrow();
  ask(q);
});

document.querySelectorAll(".suggestion").forEach((btn) =>
  btn.addEventListener("click", () => ask(btn.textContent.trim()))
);

$("newChat").addEventListener("click", () => {
  els.messages.innerHTML = "";
  els.messages.appendChild(els.emptyState);
  els.emptyState.hidden = false;
  resetSources();
  closeDrawers();
});

/* ── rendering ────────────────────────────────────────────── */
function addMessage(role, html) {
  els.emptyState.hidden = true;
  if (els.emptyState.parentNode) els.emptyState.remove();

  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  wrap.innerHTML = `
    <div class="avatar">${role === "user" ? "YOU" : "R"}</div>
    <div class="bubble">
      <div class="msg-role">${role === "user" ? "You" : "Assistant"}</div>
      <div class="msg-body">${html}</div>
    </div>`;
  els.messages.appendChild(wrap);
  els.messages.scrollTop = els.messages.scrollHeight;
  return wrap;
}

function addActions(msgEl) {
  const bar = document.createElement("div");
  bar.className = "msg-actions";
  bar.innerHTML = `
    <button class="icon-btn" title="Copy answer" aria-label="Copy answer">
      <svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
    </button>
    <button class="icon-btn" title="Good answer" aria-label="Good answer">
      <svg viewBox="0 0 24 24"><path d="M7 20V10l5-7 1.5 1.2L12 9h6a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 16.6 20H7zM7 20H4V10h3"/></svg>
    </button>
    <button class="icon-btn" title="Bad answer" aria-label="Bad answer">
      <svg viewBox="0 0 24 24"><path d="M17 4v10l-5 7-1.5-1.2L12 15H6a2 2 0 0 1-2-2.4l1.4-7A2 2 0 0 1 7.4 4H17zM17 4h3v10h-3"/></svg>
    </button>`;
  bar.children[0].addEventListener("click", () =>
    navigator.clipboard?.writeText(msgEl.querySelector(".msg-body").innerText)
  );
  msgEl.querySelector(".bubble").appendChild(bar);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/* Turns "[1]" markers in the answer into clickable citation chips. */
function withCitations(text) {
  return escapeHtml(text)
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\[(\d+)\]/g, '<button class="cite" data-cite="$1">$1</button>')}</p>`)
    .join("");
}

/* A chunk's score may arrive as `score` or as RRF's `rrf_score`; a chunk that
   only ever surfaced through the keyword pipeline may carry neither. Missing
   is rendered as "—" rather than crashing the whole panel. */
function scoreOf(chunk) {
  const raw = chunk.score ?? chunk.rrf_score;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function renderSources(chunks, meta) {
  els.sourcesMeta.innerHTML = [meta.mode, `top ${chunks.length}`, `${meta.ms ?? "—"} ms`]
    .map((t) => `<span class="pill">${escapeHtml(String(t))}</span>`)
    .join("");

  const max = Math.max(...chunks.map((c) => scoreOf(c) ?? 0), 0.0001);

  els.sourcesList.innerHTML = chunks
    .map((c, i) => {
      const score = scoreOf(c);
      return `
      <article class="source-card" data-rank="${i + 1}" style="animation-delay:${i * 40}ms">
        <div class="source-top">
          <span class="source-rank">${i + 1}</span>
          <span class="source-id">chunk #${escapeHtml(String(c.id ?? "?"))}</span>
          <span class="source-tag">${escapeHtml(c.source || meta.mode)}</span>
        </div>
        <p class="source-text">${escapeHtml(String(c.text ?? ""))}</p>
        <div class="source-score">
          <span>${score === null ? "—" : score.toFixed(4)}</span>
          <span class="meter"><i style="width:${score === null ? 0 : Math.round((score / max) * 100)}%"></i></span>
        </div>
      </article>`;
    })
    .join("");

  els.sourcesList.querySelectorAll(".source-card").forEach((card) =>
    card.addEventListener("click", () => card.classList.toggle("is-open"))
  );
}

function resetSources() {
  els.sourcesMeta.innerHTML = `<span class="pill">${els.mode.value}</span>
    <span class="pill">top ${els.topK.value}</span><span class="pill">— ms</span>`;
  els.sourcesList.innerHTML =
    '<p class="sources-empty">Ask a question to see which passages were retrieved, how they ranked, and their fusion scores.</p>';
}

/* Clicking an inline [n] chip highlights the matching chunk. */
els.messages.addEventListener("click", (e) => {
  const chip = e.target.closest(".cite");
  if (!chip) return;
  const card = els.sourcesList.querySelector(`.source-card[data-rank="${chip.dataset.cite}"]`);
  if (!card) return;
  if (window.matchMedia("(max-width: 1180px)").matches) openDrawer(els.sources);
  els.sourcesList.querySelectorAll(".source-card").forEach((c) => c.classList.remove("is-highlighted"));
  card.classList.add("is-highlighted");
  card.scrollIntoView({ behavior: "smooth", block: "center" });
});

/* ── ask flow ─────────────────────────────────────────────── */
async function ask(question) {
  busy = true;
  els.send.disabled = true;
  closeDrawers();

  addMessage("user", `<p>${escapeHtml(question)}</p>`);

  const pending = addMessage("bot", '<div class="typing"><span></span><span></span><span></span></div>');

  const params = {
    query: question,
    mode: els.mode.value,
    top_k: Number(els.topK.value),
    rrf_k: Number(els.rrfK.value),
  };

  let data;
  try {
    data = USE_MOCK ? await mockBackend(params) : await askBackend(params);
  } catch (err) {
    pending.querySelector(".msg-body").innerHTML =
      `<p>Couldn't reach the backend — ${escapeHtml(err.message)}</p>`;
    busy = false;
    autogrow();
    return;
  }

  try {
    pending.querySelector(".msg-body").innerHTML = withCitations(data.answer ?? "");
    addActions(pending);
  } finally {
    /* The sources panel is secondary — if it fails to render, keep the answer
       on screen and report the failure in the panel, not over the answer. */
    try {
      renderSources(data.chunks ?? [], { mode: params.mode, ms: data.latency_ms });
    } catch (err) {
      console.error("renderSources failed", err, data);
      els.sourcesList.innerHTML =
        `<p class="sources-empty">Couldn't render the retrieved chunks — ${escapeHtml(err.message)}</p>`;
    }
  }

  busy = false;
  autogrow();
  els.messages.scrollTop = els.messages.scrollHeight;
}

/**
 * Real call. Expected JSON response:
 * {
 *   "answer": "…prose, may contain [1] [2] citation markers…",
 *   "latency_ms": 812,
 *   "chunks": [ { "id": 42, "text": "…", "score": 0.0163, "source": "hybrid" } ]
 * }
 */
async function askBackend(params) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ── mock ─────────────────────────────────────────────────── */
const MOCK_TEXT = [
  "Red Dead Redemption 2 is a 2018 action-adventure game developed by Rockstar Games and released in October 2018 for PlayStation 4 and Xbox One, with a PC release following in November 2019.",
  "The story follows Arthur Morgan, an outlaw and senior member of the Van der Linde gang, as the group flees west after a botched ferry heist in Blackwater leaves them without money or safe haven.",
  "The game features an honor system: choices such as helping strangers, sparing surrendering enemies, or robbing civilians shift Arthur's honor rating, which in turn changes dialogue, shop prices, and parts of the epilogue.",
  "Development lasted over eight years and involved more than 1,600 people across Rockstar's studios. Motion capture and on-location scouting across the American West informed the design of the open world.",
  "Upon release the game received universal acclaim for its narrative, characters, and world design, and became one of the fastest-selling entertainment products of all time.",
];

function mockBackend({ query, top_k, mode }) {
  return new Promise((resolve) =>
    setTimeout(() => {
      const chunks = Array.from({ length: Math.min(top_k, MOCK_TEXT.length) }, (_, i) => ({
        id: 100 + i * 7,
        text: MOCK_TEXT[i % MOCK_TEXT.length],
        score: 0.0164 - i * 0.0018,
        source: mode === "hybrid" ? (i % 2 ? "vector" : "keyword") : mode,
      }));

      resolve({
        answer:
          `Here's what the retrieved passages say about "${query}".\n\n` +
          "Red Dead Redemption 2 was developed by Rockstar Games and released in October 2018 [1]. " +
          "The story centres on Arthur Morgan of the Van der Linde gang as they flee west after the Blackwater heist [2].\n\n" +
          "This is placeholder text from the mock backend — set USE_MOCK to false in app.js once your API is live.",
        latency_ms: 640 + Math.floor(Math.random() * 500),
        chunks,
      });
    }, 900)
  );
}

resetSources();
