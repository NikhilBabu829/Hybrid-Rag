from pymongo import MongoClient
import os
from rich import print
from rich.prompt import Prompt
from rich.console import Console
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
import httpx
from pydantic import ValidationError

load_dotenv()
con = Console()

client = MongoClient(os.getenv("DB_CONNECTION"))

embed_model = SentenceTransformer("sentence-transformers/all-MiniLM-L12-v2")

def sending_to_ai(results, user_query):
    api_key = os.getenv("API_KEY")

    system_prompt = f"""
        <task>Your job is to answer the question given to you based on the data we have at hand</task>
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
            print(result)
    except ValidationError as e:
        con.print(f"[red]LLM failed to output valid schema:[/red] {e}")
    except Exception as e:
        con.print(f"[red]API Error:[/red] {e}")

def continue_with_user_query(user_query : str):
    con.log("Embedding user query")
    embeded_query = embed_model.encode_query(user_query, show_progress_bar=True).tolist()
    con.log("now sending a request to get the appropriate documents")
    results = getting_data_from_db(embeded_query=embeded_query)
    con.log("retrieved results, now sending them to ai")
    sending_to_ai(results, user_query)

def getting_data_from_db(embeded_query):
    database = client.get_database("regularData")
    collection = database.get_collection("chunks")
    pipeline = [
        {
            "$vectorSearch": {
                "index": "autoembed_index",
                "path": "embedding",
                "queryVector": embeded_query,
                "numCandidates": 10,
                "limit": 3
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
    con.log("sending the request to get the data")
    results = collection.aggregate(pipeline).to_list()
    return results


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
