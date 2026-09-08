# UI

Static front-end for the RAG app. No build step, no dependencies.

```
ui/
├── index.html   markup
├── styles.css   all styling (design tokens at the top)
└── app.js       interaction only — mock data by default
```

## Run it

```bash
python -m http.server 5173 --directory ui
# → http://localhost:5173
```

## Wiring it to your backend

`app.js` ships with `USE_MOCK = true` so the UI is fully clickable
without a server. When your FastAPI route exists:

1. Set `USE_MOCK = false` and point `API_URL` at your endpoint.
2. Have that endpoint accept:

```json
{ "query": "...", "mode": "hybrid|vector|keyword", "top_k": 5, "rrf_k": 60 }
```

3. And return:

```json
{
  "answer": "prose, may contain [1] [2] citation markers",
  "latency_ms": 812,
  "chunks": [{ "id": 42, "text": "...", "score": 0.0163, "source": "hybrid" }]
}
```

`chunks` maps directly onto what `reciprocal_rank_fusion()` in `main.py`
already returns — `id`, `text`, and `rrf_score` renamed to `score`.

To serve it from FastAPI instead of the dev server:

```python
from fastapi.staticfiles import StaticFiles
app.mount("/", StaticFiles(directory="ui", html=True), name="ui")
```

## What's in the UI

- **Chat column** — messages, streaming-style typing indicator, copy /
  thumbs actions, empty state with starter questions.
- **Sources panel** — the retrieved chunks with rank, chunk id, retriever
  that surfaced it, and a score meter. Cards expand on click.
- **Citations** — `[1]` markers in an answer become chips; clicking one
  highlights and scrolls to that chunk.
- **Retrieval controls** — search mode, top-K, RRF constant. They're sent
  with each request, so your endpoint can honour them.
- Dark/light theme (persisted), responsive down to mobile with both side
  panels as drawers, and reduced-motion support.
