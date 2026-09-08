from pymongo import MongoClient
import os
from rich import print
from rich.prompt import Prompt
from rich.console import Console
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
import httpx
from pydantic import ValidationError
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List
import time

class Answer(BaseModel):
    answer : str
    latency_ms : int
    chunks : List

load_dotenv()
con = Console()
app = FastAPI()

client = MongoClient(os.getenv("DB_CONNECTION"))

embed_model = SentenceTransformer("BAAI/bge-base-en-v1.5")

def sending_to_ai(results, user_query):
    api_key = os.getenv("API_KEY")

    system_prompt = f"""
        <task>Your job is to answer the question given to you based on the data we have at hand, and include citations saying from where in the data your got your answer</task>
        <Context>
            {results}
        </Context>
    """

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }

    payload = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 500,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_query}]
    }
    try:
        with httpx.Client() as client:
            response = client.post("https://api.anthropic.com/v1/messages", headers=headers, json=payload)
            response.raise_for_status()
            result = response.json()["content"][0]["text"]
            con.log("got the response from ai")
            return result
    except ValidationError as e:
        con.print(f"[red]LLM failed to output valid schema:[/red] {e}")
    except Exception as e:
        con.print(f"[red]API Error:[/red] {e}")

def continue_with_user_query(user_query : str):
    con.log("Embedding user query")
    embeded_query = embed_model.encode_query(user_query, normalize_embeddings=True, show_progress_bar=True).tolist()
    con.log("now sending a request to get the appropriate documents")
    results = getting_data_from_db(embeded_query=embeded_query, text_query = user_query)
    return results
    con.log("retrieved results, now sending them to ai")
    # sending_to_ai(results, user_query)

def reciprocal_rank_fusion(bm25_results, vector_results, k=60):
    rrf_scores = {}
    docs_by_id = {}
    def score_results(results: list[dict]):
        for rank, doc in enumerate(results, start=1):
            doc_id = doc.get("id", doc.get("_id"))
            
            # Save doc reference for final output
            if doc_id not in docs_by_id:
                docs_by_id[doc_id] = doc

            # Accumulate RRF score
            rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + (1.0 / (k + rank))

    # Apply to both lists
    score_results(bm25_results)
    score_results(vector_results)

    # Sort documents by descending combined RRF score
    sorted_doc_ids = sorted(rrf_scores.keys(), key=lambda doc_id: rrf_scores[doc_id], reverse=True)

    # Attach the final RRF score and return sorted list
    final_ranked = []
    for doc_id in sorted_doc_ids:
        merged_doc = dict(docs_by_id[doc_id])
        merged_doc["score"] = rrf_scores[doc_id]
        final_ranked.append(merged_doc)

    return final_ranked

def getting_data_from_db(embeded_query, text_query):
    database = client.get_database("regularData")
    collection = database.get_collection("chunks")
    vector_pipeline = [
        {
            "$vectorSearch": {
                "index": "autoembed_index",
                "path": "embedding",
                "queryVector": embeded_query,
                "numCandidates": 50,
                "limit": 25
            }
        },
        {
            "$project": {
                "_id": 0,
                "id": 1,
                "text": 1,   
                "score": {"$meta": "vectorSearchScore"}
            }
        }
    ]
    keyword_pipeline = [
        {
            "$search": {
                "index": "default",  # Your Atlas Search text index name
                "text": {
                    "query": text_query,
                    "path": "text"
                }
            }
        },
        {
            "$limit": 25
        },
        {
            "$project": {
                "_id": 0,
                "id": 1,
                "text": 1
            }
        }
    ]
    con.log("sending the request to get the data")
    embedding_results = collection.aggregate(vector_pipeline).to_list()
    keyword_results = collection.aggregate(keyword_pipeline).to_list()

    merged_results = reciprocal_rank_fusion(keyword_results, embedding_results, k=60)

    return merged_results[:5]

def starter(query : str):
    startTime = time.perf_counter()
    some_value = continue_with_user_query(user_query=query)
    aiResponse = sending_to_ai(some_value, user_query=query)
    endTime = time.perf_counter()
    elapsed_time = endTime - startTime
    return Answer(answer=aiResponse, latency_ms=int(elapsed_time), chunks=some_value)

def main():
    print("Hello from production-grade-rag!")
    print("This will answer questions abuot red dead redemption 2 game")
    print("you can start asking your questions")
    while(True):
        user_query = Prompt.ask("")
        if user_query.strip() == "":
            continue
        con.log("Printing the user query")
        continue_with_user_query(user_query=user_query)
        break

if __name__ == "__main__":
    main()
