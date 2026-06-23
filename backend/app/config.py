import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "LearningLab"
    API_V1_STR: str = "/api"
    DATABASE_URL: str = "sqlite:///./data/learninglab.db"
    CHROMA_DB_PATH: str = "./data/chroma"
    LLM_API_KEY: str = "" # Provide your DeepSeek API Key here
    LLM_BASE_URL: str = "https://api.deepseek.com"
    TOKENIZER_MODEL: str = "gpt-4o-mini" # Used for tiktoken estimation only, not for actual API calls
    DEFAULT_MODEL: str = "deepseek-chat"
    COMPLEX_MODEL: str = "deepseek-reasoner"
    MAX_CONTEXT_TOKENS: int = 4000
    EMBEDDING_MODEL: str = "BAAI/bge-small-zh-v1.5"
    CHUNK_SIZE: int = 800
    CHUNK_OVERLAP: int = 50
    TOP_K_RETRIEVAL: int = 5
    ENABLE_KNOWLEDGE_RETRIEVAL: bool = True
    KNOWLEDGE_SCORE_THRESHOLD: float = 0.5
    KNOWLEDGE_SNIPPET_LENGTH: int = 300
    ENABLE_WEB_SEARCH: bool = True
    ENABLE_PLAN_GENERATION: bool = True
    BOCHA_ENDPOINT: str = "https://api.bocha.cn/v1/web-search"
    BOCHA_API_KEY: str = ""
    SUMMARY_TRIGGER_COUNT: int = 10
    SUMMARY_MAX_TOKENS: int = 300
    FORCE_WEB_SEARCH: bool = False
    AUTO_VERIFY_CREDIBILITY: bool = True

    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()
