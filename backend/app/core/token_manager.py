import logging
from typing import List, Dict
from app.config import settings

logger = logging.getLogger(__name__)

def count_tokens(text: str, model: str | None = None) -> int:
    """计算单个字符串的 Token 数量
    注意：此处的 model 参数仅用于选择 tiktoken 编码器，不影响实际的 LLM 调用。
    """
    model = model or settings.TOKENIZER_MODEL
    try:
        import tiktoken
        try:
            encoding = tiktoken.encoding_for_model(model)
        except KeyError:
            # 当提供不支持的模型名称时，回退到 cl100k_base 编码（适用于 GPT-3.5/4）
            encoding = tiktoken.get_encoding("cl100k_base")
        return len(encoding.encode(text))
    except ImportError:
        # 兜底算法：简单的字符估算
        logger.warning("tiktoken not installed or imported failed. Using character count fallback (len/4).")
        return len(text) // 4

def count_messages_tokens(messages: List[Dict], model: str | None = None) -> int:
    """计算消息列表的总 Token 数"""
    model = model or settings.TOKENIZER_MODEL
    try:
        import tiktoken
        try:
            encoding = tiktoken.encoding_for_model(model)
        except KeyError:
            encoding = tiktoken.get_encoding("cl100k_base")
            
        num_tokens = 0
        for message in messages:
            num_tokens += 4  # 每条消息开头/结尾的开销: <im_start>{role/name}\n{content}<im_end>\n
            for key, value in message.items():
                if isinstance(value, str):
                    num_tokens += len(encoding.encode(value))
        num_tokens += 2  # prompt 开局的 <im_start>assistant
        return num_tokens
        
    except ImportError:
        # 兜底算法
        total_len = sum(len(str(v)) for msg in messages for v in msg.values())
        return total_len // 4 + len(messages) * 4 + 2

def manage_context(messages: List[Dict], max_tokens: int = 4000, model: str | None = None) -> List[Dict]:
    """管理上下文 Token：当超过限制时进行裁剪和摘要化，确保总体 Token 数量安全。"""
    model = model or settings.TOKENIZER_MODEL
    current_tokens = count_messages_tokens(messages, model)
    if current_tokens <= max_tokens:
        return messages
        
    logger.info(f"Context tokens ({current_tokens}) exceed max_tokens ({max_tokens}). Starting compression.")
    
    system_messages = [msg for msg in messages if msg.get("role") == "system"]
    other_messages = [msg for msg in messages if msg.get("role") != "system"]
    
    # 策略：保留最后 4 轮对话（即 8 条消息：4 user + 4 assistant）
    recent_count = 8
    recent_messages = other_messages[-recent_count:] if len(other_messages) > recent_count else other_messages
    
    # 占位符：模拟我们总结了更早以前的消息
    summary_message = {
        "role": "system",
        "content": "[Earlier conversation summarized]"
    }
    
    compressed_messages = system_messages + [summary_message] + recent_messages
    
    # 如果裁剪后依然超标（比如用户输入了巨长的一段文本），则需进一步从最早的近况消息开始剔除，直至符合大小限制
    while count_messages_tokens(compressed_messages, model) > max_tokens and len(recent_messages) > 1:
        recent_messages.pop(0)
        compressed_messages = system_messages + [summary_message] + recent_messages
        
    logger.info(f"Compressed context to {count_messages_tokens(compressed_messages, model)} tokens.")
    
    return compressed_messages

def truncate_text_by_tokens(text: str, max_tokens: int, model: str | None = None) -> str:
    """按 Token 数截断文本，保留完整句子"""
    if model is None:
        model = settings.TOKENIZER_MODEL
    current_tokens = count_tokens(text, model)
    if current_tokens <= max_tokens:
        return text
    
    # 按照正常句子截断
    sentences = text.split('。')
    # 处理末尾的空字符串（如果原文以句号结尾）
    if sentences and not sentences[-1]:
        sentences.pop()
        
    while sentences and count_tokens('。'.join(sentences) + '。', model) > max_tokens:
        sentences.pop()
        
    if not sentences:
        return text[:max_tokens]
    return '。'.join(sentences) + '。'
