import os
import sys
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "packages" / "db" / ".env")

def get_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise ValueError("DATABASE_URL environment variable is required but not set.")
    return url

def get_global_database_url() -> str:
    url = os.environ.get("GLOBAL_DATABASE_URL")
    if not url:
        url = os.environ.get("DATABASE_URL")
    if not url:
        raise ValueError("GLOBAL_DATABASE_URL environment variable is required but not set.")
    return url

def get_api_key() -> str:
    key = os.environ.get("GROWX_LOCATION_API_KEY") or os.environ.get("API_KEY")
    if not key:
        raise ValueError("GROWX_LOCATION_API_KEY environment variable is required but not set.")
    return key
