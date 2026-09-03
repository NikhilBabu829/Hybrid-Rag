from pymongo import MongoClient
import wikipediaapi
from sentence_transformers import SentenceTransformer
from langchain_text_splitters import RecursiveCharacterTextSplitter
import os
import json
from dotenv import load_dotenv
from rich import print
load_dotenv()

embed_model = SentenceTransformer("sentence-transformers/all-MiniLM-L12-v2")

client = MongoClient(os.getenv("DB_CONNECTION"))
EmbededData = client.get_database("EmbededData")
embed_collection = EmbededData.get_collection("embeddings")
regularData = client.get_database("regularData")
regular_collection = regularData.get_collection("chunks")

def chunk_data(data):
    splitter = RecursiveCharacterTextSplitter(
        chunk_size = 500,
        chunk_overlap = 75,
        separators=["\n\n", "\n", " ", ""]
    )
    chunks = splitter.split_text(data)
    embeded_data = embed_model.encode(chunks, show_progress_bar=True)
    documents_to_insert = [
        {
            "id" : i,
            "text" : chunk,
        }
        for i, chunk in enumerate(chunks)
    ]
    for index, embedding in enumerate(embeded_data):
        documents_to_insert[index].update({"embedding" : embedding.tolist()})
    try:
        regular_collection.insert_many(documents_to_insert)
    except Exception as e:
        print(e)

def testing():
    with open("evalset.json", "r") as j:
        data = json.load(j)
    for doc in data:
        question = doc["question"]
        print(f"Questions is: {question}")
        expected_answer = doc["expected_answer"]
        print(f"Expected Answer is: {expected_answer}")
        embed_question = embed_model.encode_query(question).tolist()
        pipeline = [
            {
                "$vectorSearch": {
                    "index": "autoembed_index",
                    "path": "embedding",
                    "queryVector": embed_question,
                    "numCandidates": 10,
                    "limit": 3
                }
            },
            {
                # Use $project to select the fields you want back
                "$project": {
                    "_id": 0,
                    "id": 1,
                    "text": 1,   
                    "score": {"$meta": "vectorSearchScore"}
                }
            }
        ]
        print("Results from the db")
        results = list(regular_collection.aggregate(pipeline))
        print(results)
        print("*********************************************\n")


def main():
    # wiki = wikipediaapi.Wikipedia(user_agent='Production-Grade-Rag (nikhilbabu829@gmail.com)', language='en')
    # page_py = wiki.page('Red Dead Redemption 2')
    # chunk_data(page_py.text)
    testing()


if __name__ == "__main__":
    main()