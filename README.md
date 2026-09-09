# Hybrid-RAG — Red Dead Redemption 2

A retrieval-augmented question-answering system over the Red Dead Redemption 2 Wikipedia article. It runs vector search and keyword search in parallel, merges the two ranked lists with Reciprocal Rank Fusion, and returns answers that cite the passages they were built from.

The corpus is incidental. The point of the project is the retrieval layer: two retrievers, a principled way to combine them, and a UI that shows exactly what was retrieved and how it ranked.

## How it works

```
Wikipedia article
      │
      ▼
  chunk (700 chars / 120 overlap)  ──►  embed (bge-base-en-v1.5)  ──►  MongoDB Atlas
                                                                            │
user query ──┬──► embed ──► $vectorSearch ──┐                               │
             │                              ├──► Reciprocal Rank Fusion ──► top-k chunks
             └──► $search (Atlas Search) ───┘                                     │
                                                                                  ▼
                                                        numbered context block ──► Claude Haiku
                                                                                  │
                                                                                  ▼
                                                                    answer with [n] citations
```

**Reciprocal Rank Fusion.** RRF discards the raw scores from each retriever and works purely off rank position. A document appearing at rank *r* in a list contributes `1 / (k + r)` to its total, summed across every list it appears in. Documents both retrievers agree on rise to the top, but a document ranked first by one retriever and missed entirely by the other can still surface. There is no score normalisation to tune and no per-query calibration — which is the reason to prefer it over weighted score blending when the two scoring scales aren't comparable.

**Citations.** Retrieved chunks are numbered before being placed in the context block, and the model is instructed to cite against those indices. The front end parses each `[n]` marker into a chip that scrolls to the matching chunk in the sources panel and highlights it, alongside its fusion score. An answer that can't be traced back to a retrieved passage is visible immediately.

## Stack

| Layer | Choice |
|---|---|
| Vector + keyword store | MongoDB Atlas (`$vectorSearch` + Atlas Search) |
| Embeddings | `BAAI/bge-base-en-v1.5` (768-dim) via sentence-transformers |
| Chunking | LangChain `RecursiveCharacterTextSplitter` |
| Generation | Claude Haiku (Anthropic Messages API) |
| API | FastAPI |
| Front end | Vanilla HTML / CSS / JS |

## Setup

### 1. Prerequisites

- Python 3.10+
- A MongoDB Atlas cluster (M0 free tier is enough)
- An Anthropic API key

### 2. Environment

Create a `.env` in the project root:

```
DB_CONNECTION=mongodb+srv://<user>:<password>@<cluster>/
API_KEY=sk-ant-...
```

### 3. Install

```bash
pip install -r requirements.txt
```

The first run downloads the embedding model (~440 MB).

### 4. Create the Atlas indexes

Both indexes are on the `regularData.chunks` collection. Neither is created by the ingestion script — make them in the Atlas UI before querying, or retrieval will silently return nothing.

**Vector index**, named `autoembed_index`:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 768,
      "similarity": "cosine"
    }
  ]
}
```

**Atlas Search index**, named `default`:

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "text": { "type": "string" }
    }
  }
}
```

The dimension count is tied to the embedding model. Changing the model means changing `numDimensions` and re-ingesting everything.

### 5. Ingest the corpus

```bash
python get-data.py
```

Fetches the article, chunks it, embeds each chunk, and inserts text + vector into Atlas. To start over, `python delete-script.py` clears the collection.

### 6. Run

```bash
uvicorn api:app --reload --port 8000
```

Then serve the front end:

```bash
cd ui && python -m http.server 5173
```

Open `http://127.0.0.1:5173`. The API's CORS allowlist is defined in `api.py` — if you serve the UI on a different port, add it there or the browser will block every request.

## Configuration

The sidebar controls are passed through to the retrieval pipeline on every request:

| Control | Effect |
|---|---|
| Search mode | Hybrid |
| Top K | Number of chunks passed to the model as context |
| RRF constant | The `k` in `1 / (k + rank)`. Lower values weight top-ranked results more sharply; 60 is the value from the original RRF paper |

## Evaluation

`evalset.json` holds questions paired with their expected answers and the article section the answer should come from. It's used to sanity-check retrieval after a change — chunking parameters, embedding model, fusion constant — so quality judgements aren't purely impressionistic.

This is manual inspection, not measurement. See limitations.

## Notes from the build

**The embedding model was the bottleneck, not the fusion logic.** Retrieval quality was poor on `all-MiniLM-L6-v2`, a 384-dimension general-purpose model. Switching to `bge-base-en-v1.5` fixed it. Because the vector dimensions changed, this meant dropping and re-ingesting the entire collection — worth knowing before you pick an embedding model for anything with real data in it.

**BGE is asymmetric.** Queries need a retrieval instruction prefix; document chunks do not. Embedding both sides identically costs you most of the benefit of the model, and it fails silently — retrieval still returns results, they're just worse.

## Limitations

Honest list of what this doesn't do:

- **No retrieval metrics.** The eval set is checked by eye. There's no recall@k, MRR, or nDCG, and no regression run.
- **No reranking.** A cross-encoder rerank pass over the fused results would likely be the single biggest quality gain available.
- **No auth, rate limiting, or request logging** on the API.
- **No tests, no CI, no container.**
- **No streaming.** Responses arrive in full or not at all.
- **Single-turn only.** Conversation history isn't sent to the model, and the sidebar's history list is static.
- **Single-document corpus.** Chunk provenance is trivially known, so nothing here handles multi-source attribution.

## Next

- Retrieval metrics against an expanded eval set
- Cross-encoder rerank stage after fusion
- Streaming responses
- Multi-turn context

## Repo structure

```
get-data.py       Fetch, chunk, embed, ingest
delete-script.py  Clear the chunks collection
main.py           Retrieval, RRF, and the call to Claude
api.py            FastAPI wrapper
evalset.json      Retrieval sanity-check questions
ui/               Front end (index.html, styles.css, app.js)
```