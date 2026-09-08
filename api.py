from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from main import starter
from pydantic import BaseModel
from typing import List
from rich import print

class Query(BaseModel):
    query : str
    mode : str
    top_k : int
    rrf_k : int

class Answer(BaseModel):
    answer : str
    latency_ms : int
    chunks : List

app = FastAPI()

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/chat")
async def main(query : Query):
    returned_value = starter(query=query.query)
    return returned_value