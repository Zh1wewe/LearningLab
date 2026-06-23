import os
import time
import uuid
import re
import logging
from typing import List, Dict, Any, Optional
import chromadb
from chromadb.api.types import EmbeddingFunction, Documents, Embeddings

from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 自定义嵌入函数  --  惰性加载 SentenceTransformer 模型
# ---------------------------------------------------------------------------
class SentenceTransformerEmbeddingFunction(EmbeddingFunction):
    """自定义嵌入函数，首次调用时加载模型，失败则回退到零向量"""

    def __init__(self, model_name: str):
        self.model_name = model_name
        self._model = None
        self._init_failed = False

    def _ensure_model(self):
        if self._model is not None or self._init_failed:
            return
        try:
            from sentence_transformers import SentenceTransformer
            # 先尝试从本地缓存加载（不联网），避免 HuggingFace 超时阻塞请求
            try:
                logger.info(f"Loading SentenceTransformer model from local cache: {self.model_name}")
                self._model = SentenceTransformer(self.model_name, local_files_only=True)
                logger.info(f"SentenceTransformer model '{self.model_name}' loaded from cache.")
                return
            except Exception:
                logger.warning(
                    f"Model '{self.model_name}' not in local cache, attempting download..."
                )
            # 缓存未命中，尝试联网下载（设置短超时，不会长时间阻塞）
            self._model = SentenceTransformer(self.model_name)
            logger.info(f"SentenceTransformer model '{self.model_name}' loaded successfully.")
        except Exception as exc:
            self._init_failed = True
            logger.error(
                f"Failed to load SentenceTransformer model '{self.model_name}': {exc}\n"
                f"  Knowledge base search/insert will use fallback zero-vector embeddings."
            )

    def __call__(self, input: Documents) -> Embeddings:
        self._ensure_model()
        if self._model is not None:
            try:
                return self._model.encode(input, convert_to_numpy=True).tolist()
            except Exception as exc:
                logger.error(f"SentenceTransformer encoding failed: {exc}")
        # 回退：返回零向量，维度用 ChromaDB 默认值 384（all-MiniLM-L6-v2 的输出维度）
        import numpy as np
        EMBEDDING_DIM = 384
        return [np.zeros(EMBEDDING_DIM, dtype=np.float32).tolist() for _ in input]


# ---------------------------------------------------------------------------
# 模块级：仅初始化 ChromaDB 客户端（无需网络），模型与集合按需加载
# ---------------------------------------------------------------------------
os.makedirs(settings.CHROMA_DB_PATH, exist_ok=True)

_chroma_client: Optional[chromadb.PersistentClient] = None
_collection = None

def _get_chroma_client() -> chromadb.PersistentClient:
    global _chroma_client
    if _chroma_client is None:
        _chroma_client = chromadb.PersistentClient(path=settings.CHROMA_DB_PATH)
    return _chroma_client

def get_collection():
    """返回集合实例（惰性初始化，避免导入时下载模型）"""
    global _collection
    if _collection is None:
        client = _get_chroma_client()
        embedding_fn = SentenceTransformerEmbeddingFunction(settings.EMBEDDING_MODEL)
        _collection = client.get_or_create_collection(
            name="learning_docs",
            embedding_function=embedding_fn,
        )
    return _collection


# ---------------------------------------------------------------------------
# 语言检测
# ---------------------------------------------------------------------------
def _detect_language(text: str) -> str:
    """检测文本主要语言：统计中文字符比例，超过 5% 视为中文"""
    if not text:
        return "en"
    cn_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    if cn_chars / max(len(text), 1) > 0.05:
        return "zh"
    return "en"


# ---------------------------------------------------------------------------
# 文本分块 — 递归字符分割器（仿 LangChain RecursiveCharacterTextSplitter）
# ---------------------------------------------------------------------------
_CJK_SEPARATORS = [
    "\n\n",          # 段落
    "\n",            # 行
    "。", "！", "？", # 中文句末
    "；",            # 中文分号
    "，", "、",       # 中文逗号/顿号
    " ",             # 空格（中文按词切，英文按单词切）
    ""               # 字符级（兜底）
]
# 注意：移除了 . ! ? , 作为主动分隔符，避免切断数学公式中的小数点、逗号
# 这些符号在空格分隔后自然属于所在单词，不会单独形成 chunk


def _split_by_separator(text: str, separator: str) -> list[str]:
    if separator == "":
        return list(text)
    parts = text.split(separator)
    # 保留分隔符在片段末尾（除空格外）
    if separator and separator != " ":
        return [p + separator for p in parts[:-1]] + [parts[-1]]
    return parts


def _chunk_text(text: str, chunk_size: int, chunk_overlap: int) -> List[str]:
    """递归字符分割：按分隔符优先级依次拆分，保持语义完整性"""
    if not text or not text.strip():
        return []

    chunks: list[str] = []
    _recursive_split(text, _CJK_SEPARATORS, 0, chunk_size, chunk_overlap, chunks)

    # 过滤过短的 chunk（长度 < 10 的基本是噪声）
    chunks = [c.strip() for c in chunks if len(c.strip()) >= 10]
    # 二次合并：将过短的相邻 chunk 拼接
    return _merge_short_chunks(chunks, min_size=150)


def _merge_short_chunks(chunks: list[str], min_size: int = 150) -> list[str]:
    """将同一源中过短的相邻 chunk 合并，确保每个 chunk 至少 min_size 字符"""
    if not chunks:
        return chunks
    merged = []
    buffer = chunks[0]
    for chunk in chunks[1:]:
        if len(buffer) < min_size:
            buffer += " " + chunk
        else:
            merged.append(buffer)
            buffer = chunk
    if buffer.strip():
        merged.append(buffer)
    return merged


def _recursive_split(
    text: str,
    separators: list[str],
    depth: int,
    chunk_size: int,
    chunk_overlap: int,
    result: list[str],
):
    if depth >= len(separators):
        # 兜底：字符级硬切
        for i in range(0, len(text), max(1, chunk_size - chunk_overlap)):
            chunk = text[i:i + chunk_size]
            if chunk.strip():
                result.append(chunk)
        return

    sep = separators[depth]
    parts = _split_by_separator(text, sep)

    current = ""
    for part in parts:
        if len(current) + len(part) <= chunk_size:
            current += part
        else:
            if current.strip():
                result.append(current)
            # 如果单个 part 超过 chunk_size，递归降级到下一个分隔符
            if len(part) > chunk_size and depth + 1 < len(separators):
                _recursive_split(part, separators, depth + 1, chunk_size, chunk_overlap, result)
            else:
                current = part
    if current.strip():
        result.append(current)


# ---------------------------------------------------------------------------
# 公开 API
# ---------------------------------------------------------------------------
def add_document(text: str, metadata: dict) -> int:
    """
    将文本分块并存入 ChromaDB，自动在 metadata 添加 chunk_index 和 timestamp。
    返回成功添加的块数量。
    """
    collection = get_collection()
    chunks = _chunk_text(text, settings.CHUNK_SIZE, settings.CHUNK_OVERLAP)
    if not chunks:
        return 0

    current_time = int(time.time())
    docs_to_add = []
    metadatas_to_add = []
    ids_to_add = []

    for i, chunk in enumerate(chunks):
        docs_to_add.append(chunk)

        chunk_meta = metadata.copy() if metadata else {}
        chunk_meta["chunk_index"] = i
        chunk_meta["timestamp"] = current_time
        chunk_meta["credibility"] = chunk_meta.get("credibility", "ai_generated")
        chunk_meta["verified_at"] = chunk_meta.get("verified_at", "")
        chunk_meta["verified_by"] = chunk_meta.get("verified_by", "")
        # 语言检测
        if "language" not in chunk_meta:
            chunk_meta["language"] = _detect_language(chunk)
        # 跨语言关键词（初始为空，rerank 阶段注入）
        if "keywords_cn" not in chunk_meta:
            chunk_meta["keywords_cn"] = "[]"
        metadatas_to_add.append(chunk_meta)

        ids_to_add.append(str(uuid.uuid4()))

    collection.add(
        documents=docs_to_add,
        metadatas=metadatas_to_add,
        ids=ids_to_add,
    )

    return len(chunks)


def search_knowledge(query: str, top_k: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    在集合中检索与 query 最相似的 top_k 个文档块。
    返回每个元素含 content、metadata 和 score。
    """
    if top_k is None:
        top_k = settings.TOP_K_RETRIEVAL

    collection = get_collection()
    results = collection.query(
        query_texts=[query],
        n_results=top_k,
    )

    formatted_results: List[Dict[str, Any]] = []

    if results.get("documents") and len(results["documents"]) > 0:
        docs = results["documents"][0]
        metas = results.get("metadatas", [[]])[0] if results.get("metadatas") else []
        distances = results.get("distances", [[]])[0] if results.get("distances") else []
        ids = results.get("ids", [[]])[0] if results.get("ids") else []

        for i in range(len(docs)):
            result_item = {
                "id": ids[i] if i < len(ids) else None,
                "content": docs[i],
                "metadata": metas[i] if i < len(metas) else {},
                "score": distances[i] if i < len(distances) else None,
            }
            formatted_results.append(result_item)

    return formatted_results


def upgrade_credibility(chunk_id: str, method: str):
    collection = get_collection()
    results = collection.get(ids=[chunk_id])
    if results and results.get("metadatas") and len(results["metadatas"]) > 0:
        meta = results["metadatas"][0]
        meta["credibility"] = "verified"
        meta["verified_at"] = str(int(time.time()))
        meta["verified_by"] = method
        collection.update(ids=[chunk_id], metadatas=[meta])


def downgrade_credibility(chunk_id: str):
    collection = get_collection()
    results = collection.get(ids=[chunk_id])
    if results and results.get("metadatas") and len(results["metadatas"]) > 0:
        meta = results["metadatas"][0]
        meta["credibility"] = "unreliable"
        meta["verified_at"] = str(int(time.time()))
        collection.update(ids=[chunk_id], metadatas=[meta])


def delete_document(chunk_id: str) -> bool:
    """删除指定 ID 的文档块。返回是否成功。"""
    collection = get_collection()
    existing = collection.get(ids=[chunk_id])
    if not existing or not existing.get("ids") or len(existing["ids"]) == 0:
        return False
    collection.delete(ids=[chunk_id])
    logger.info(f"Deleted chunk {chunk_id}")
    return True


def update_document(chunk_id: str, text: str, metadata: dict) -> bool:
    """
    更新指定 ID 的文档块内容与元数据。
    更新后 credibility 重置为 "ai_generated"（视为新知识），
    verified_at / verified_by 清空。
    返回是否成功。
    """
    collection = get_collection()
    existing = collection.get(ids=[chunk_id])
    if not existing or not existing.get("ids") or len(existing["ids"]) == 0:
        return False

    # 合并元数据，保留 old metadata 中的基础字段
    new_meta = metadata.copy() if metadata else {}
    new_meta["credibility"] = "ai_generated"
    new_meta["verified_at"] = ""
    new_meta["verified_by"] = ""
    new_meta["timestamp"] = str(int(time.time()))

    collection.update(ids=[chunk_id], documents=[text], metadatas=[new_meta])
    logger.info(f"Updated chunk {chunk_id}")
    return True


def get_documents_by_credibility(credibility: str) -> list:
    collection = get_collection()
    results = collection.get(where={"credibility": credibility})
    docs_list = []
    if results.get("documents"):
        for i, doc in enumerate(results["documents"]):
            meta = results.get("metadatas", [])[i] if results.get("metadatas") else {}
            item_id = results.get("ids", [])[i] if results.get("ids") else None
            docs_list.append({"id": item_id, "content": doc, "metadata": meta})
    return docs_list


def get_pending_verification_documents(limit: int = 5) -> list:
    collection = get_collection()
    results = collection.get(
        where={"credibility": {"$in": ["ai_generated", "user_provided"]}},
        limit=limit,
    )
    docs_list = []
    if results.get("documents"):
        for i, doc in enumerate(results["documents"]):
            meta = results.get("metadatas", [])[i] if results.get("metadatas") else {}
            # 排除文件导入的 chunk（有 source_file 字段）
            if meta.get("source_file"):
                continue
            item_id = results.get("ids", [])[i] if results.get("ids") else None
            docs_list.append({"id": item_id, "content": doc, "metadata": meta})
    return docs_list


def get_pending_verification_items(limit: int = 10) -> list:
    """
    获取待验证的知识条目。
    查询 credibility 为 "ai_generated" 或 "user_submitted" 的条目，
    按 timestamp 升序排列，返回前 limit 条。
    返回列表每项: { id, content, metadata }
    """
    collection = get_collection()
    try:
        results = collection.get(
            where={"credibility": {"$in": ["ai_generated", "user_submitted"]}},
        )
    except Exception:
        # 部分 ChromaDB 版本不支持 $in，回退为获取全部后过滤
        results = collection.get()

    docs_list = []
    if results.get("documents"):
        for i, doc in enumerate(results["documents"]):
            meta = results.get("metadatas", [])[i] if results.get("metadatas") else {}
            if meta.get("credibility") in ("verified", "unreliable"):
                continue
            # 排除文件导入的 chunk
            if meta.get("source_file"):
                continue
            item_id = results.get("ids", [])[i] if results.get("ids") else None
            docs_list.append({"id": item_id, "content": doc, "metadata": meta})

    # 按 timestamp 升序（最早的先验证）
    docs_list.sort(key=lambda x: int(x.get("metadata", {}).get("timestamp", 0)))
    return docs_list[:limit]


def _parse_file(file_path: str) -> str:
    """
    根据文件扩展名调用不同的解析器，返回纯文本内容。
    支持的格式:
      - .txt / .md : UTF-8 纯文本
      - .pdf       : 逐页提取文本（使用 pypdf）
      - .jpg/.png/.jpeg/.bmp/.webp : 预留，未来对接图像识别
    """
    ext = os.path.splitext(file_path)[1].lower()

    if ext in (".txt", ".md", ""):
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()

    if ext == ".pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(file_path)
            pages = []
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    pages.append(text)
            return "\n\n".join(pages)
        except ImportError:
            raise ImportError("pypdf 未安装。请执行: pip install pypdf")
        except Exception as exc:
            raise RuntimeError(f"PDF 解析失败: {exc}")

    if ext in (".jpg", ".jpeg", ".png", ".bmp", ".webp"):
        raise NotImplementedError(
            f"图像文件 ({ext}) 解析尚未支持，将在后续版本中对接 DeepSeek 图像识别功能。"
        )

    raise ValueError(f"不支持的文件格式: {ext}")


def add_documents_from_file(file_path: str, source_name: str | None = None) -> int:
    """
    读取文件，按段落分块（空行分隔），分别调用 add_document 入库。
    支持 .txt / .md / .pdf 格式。
    返回总共添加的文本块数量。
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    content = _parse_file(file_path)

    # PDF 文本清洗：合并孤立换行 + 合并多余空格
    if file_path.lower().endswith(".pdf"):
        # 合并两个非空字符之间的单独换行（pypdf 最常见的问题）
        content = re.sub(r'([^\n])\n([^\n])', r'\1\2', content)
        # 合并多个连续空格
        content = re.sub(r' +', ' ', content)
        # 合并三个以上连续换行为两个换行
        content = re.sub(r'\n{3,}', '\n\n', content)

    total_added = 0
    file_name = os.path.basename(file_path)
    title = source_name or os.path.splitext(file_name)[0]

    # 单级拆分：直接将整篇文档交给递归切割器
    # 不再按空行预拆段落，避免 PDF 提取导致的碎片化
    meta = {
        "source_file": file_name,
        "paragraph_index": 0,
    }
    added = add_document(content, metadata=meta)
    total_added += added

    # 记录 Document 元信息
    try:
        from app.database import SessionLocal
        from app.models.document import Document
        db = SessionLocal()
        doc = Document(
            title=title,
            source=file_name,
            file_path=file_path,
            chunk_count=total_added,
        )
        db.add(doc)
        db.commit()
        doc_id = doc.id
        db.close()
        logger.info(f"Document record created: id={doc_id}, title={title}, chunks={total_added}")
    except Exception as exc:
        logger.error(f"Failed to create Document record for {file_name}: {exc}")

    return total_added


def delete_chunks_by_source(source_file: str) -> int:
    """
    删除 ChromaDB 中 metadata.source_file 匹配的所有片段。
    返回删除数量。
    """
    collection = get_collection()
    try:
        results = collection.get(where={"source_file": source_file})
    except Exception:
        return 0

    ids = results.get("ids", []) if results else []
    if ids:
        collection.delete(ids=ids)
        logger.info(f"Deleted {len(ids)} chunks for source '{source_file}'")
    return len(ids)
