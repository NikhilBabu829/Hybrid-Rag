from pymongo import MongoClient
import os
from dotenv import load_dotenv
from rich.console import Console

load_dotenv()
MOGNOCONNECTION = os.getenv("DB_CONNECTION")
con = Console()

def main():
    client = MongoClient(MOGNOCONNECTION)
    database = client.get_database("regularData")
    collection = database.get_collection("chunks")
    response = collection.delete_many({})
    print(response)

if __name__ == "__main__":
    main()
