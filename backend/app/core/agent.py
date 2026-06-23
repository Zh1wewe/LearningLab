import logging
import json
from openai import AsyncOpenAI, OpenAIError
from app.config import settings
from app.core.token_manager import count_messages_tokens
from app.core import knowledge

logger = logging.getLogger(__name__)

def search_knowledge_base(query: str) -> list[dict]:
    try:
        results = knowledge.search_knowledge(query)
    except Exception as e:
        logger.error(f"Knowledge base search failed: {e}")
        return [{"content": f"Knowledge base search error: {e}", "source": "system", "score": 0, "id": ""}]
    if not results:
        return [{"content": "No relevant documents found.", "source": "system", "score": 0, "id": ""}]
    
    formatted_results = []
    for r in results:
        source = r.get("metadata", {}).get("source", "unknown")
        if source == "unknown" and r.get("metadata", {}).get("source_file"):
            source = r.get("metadata", {}).get("source_file")
            
        credibility = r.get("metadata", {}).get("credibility", "ai_generated")
        if credibility == "verified":
            source = f"[已验证来源] {source}"
        elif credibility == "user_submitted":
            source = f"[用户笔记] {source}"
        elif credibility == "unreliable":
            source = f"[已被证伪，仅供参考] {source}"
        else:
            source = f"[待验证] {source}"
            
        formatted_results.append({
            "id": r.get("id", ""),
            "content": r["content"],
            "source": source,
            "score": r["score"],
            "credibility": credibility
        })
    return formatted_results

async def llm_evaluate_credibility(knowledge_content: str, search_results: list[dict]) -> str:
    """使用 LLM 判断知识可信度应升级、降级还是保持"""
    if not search_results:
        return "keep"
    
    # 提取搜索结果的前 3 条摘要拼接成一个字符串
    search_texts = []
    for result in search_results[:3]:
        snippet = ""
        if isinstance(result, dict):
            snippet = result.get("content", "") or result.get("snippet", "")
        else:
            snippet = str(result)
        if snippet:
            search_texts.append(snippet)
    search_text = " ".join(search_texts)
    
    if not search_text:
        return "keep"
        
    prompt = f"""请判断以下两个内容在事实上是否一致。
内容1（知识库片段）：{knowledge_content}
内容2（联网搜索结果）：{search_text}

仅回答一个词：一致、矛盾 或 无法判断。"""

    try:
        llm = await _get_client_for_model(settings.DEFAULT_MODEL)
        response = await llm.chat.completions.create(
            model=settings.DEFAULT_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )
        answer = response.choices[0].message.content.strip()
        
        if "一致" in answer:
            return "upgrade"
        elif "矛盾" in answer:
            return "downgrade"
        else:
            return "keep"
    except Exception as e:
        logger.error(f"Error evaluating credibility via LLM: {e}")
        return "keep"

AVAILABLE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge_base",
            "description": "搜索本地知识库，获取相关文档片段。当用户询问某个概念、方法或需要参考资料时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索查询"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "联网搜索最新信息、论文或技术动态。当用户的问题需要实时信息或本地知识库无法覆盖时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                     "query": {"type": "string", "description": "搜索查询"},
                     "max_results": {"type": "integer", "description": "最大结果数，默认5"},
                    "freshness": {
                         "type": "string",
                        "description": "时间范围: noLimit(不限), Day(一天内), Week(一周内), Month(一月内)",
                         "enum": ["noLimit", "Day", "Week", "Month"]
        }
    },
    "required": ["query"]
}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_learning_plan",
            "description": "为用户生成一个结构化的学习计划。当用户要求制定学习路线、学习某个主题或复习计划时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "学习主题"},
                    "days": {"type": "integer", "description": "计划天数，默认7"}
                },
                "required": ["topic"]
            }
        }
    }
]

def _create_client(api_key: str, base_url: str | None = None) -> AsyncOpenAI:
    """创建一个 OpenAI 客户端，若 API Key 为空则抛出异常"""
    if not api_key:
        raise ValueError("API Key 未配置，请在设置页面添加模型配置")
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return AsyncOpenAI(**kwargs)


async def _get_client_for_model(model_id: str | None = None) -> AsyncOpenAI:
    """根据 model_id 从 ModelConfig 表中查找 API Key 和 Base URL。
    未找到时回退到 .env 配置。"""
    # 1. 尝试从 model_configs 表查找
    if model_id:
        try:
            from app.database import SessionLocal
            from app.models.model_config import ModelConfig
            db = SessionLocal()
            config = db.query(ModelConfig).filter(ModelConfig.model_id == model_id).first()
            db.close()
            if config and config.api_key and config.base_url:
                return _create_client(config.api_key, config.base_url)
        except Exception:
            pass

    # 2. 回退到 .env 全局配置
    return _create_client(settings.LLM_API_KEY, settings.LLM_BASE_URL)

async def stream_chat(messages: list[dict], model: str | None = None):
    model = model or settings.DEFAULT_MODEL
    try:
        token_count = count_messages_tokens(messages, model)
        print(f"[{model}] Sent request with estimated tokens: {token_count}")
        logger.info(f"[{model}] Sent request with estimated tokens: {token_count}")

        llm = await _get_client_for_model(model)
        response = await llm.chat.completions.create(
            model=model,
            messages=messages,
            stream=True
        )
        
        async for chunk in response:
            if chunk.choices and len(chunk.choices) > 0:
                delta = chunk.choices[0].delta
                if delta and delta.content:
                    yield delta.content

    except OpenAIError as e:
        error_msg = f"[Error] LLM API Error: {str(e)}"
        print(error_msg)
        logger.error(error_msg)
        yield error_msg
    except Exception as e:
        error_msg = f"[Error] Unexpected chat stream error: {str(e)}"
        print(error_msg)
        logger.error(error_msg)
        yield error_msg

async def execute_tool(tool_name: str, arguments: dict) -> str:
    """Execute a specific tool and return JSON string result."""
    try:
        logger.info(f"Executing tool: {tool_name} with args: {arguments}")
        if tool_name == "search_knowledge_base":
            query = arguments.get("query", "")
            result = search_knowledge_base(query)
            return json.dumps(result, ensure_ascii=False)
        elif tool_name == "web_search":
            # 局部导入，避免循环依赖
            from app.tools.web_search import web_search
            query = arguments.get("query", "")
            max_results = arguments.get("max_results", 5)
            freshness = arguments.get("freshness", "noLimit")
            result = web_search(query, max_results, freshness)
            
            # 自动可信度验证
            try:
                from app.core.knowledge import search_knowledge, upgrade_credibility, downgrade_credibility
                kb_results = search_knowledge(query, top_k=3)
                for item in kb_results:
                    cred = item.get("metadata", {}).get("credibility")
                    if cred in ("verified", "unreliable"):
                        continue
                    action = await llm_evaluate_credibility(item["content"], result)
                    if action == "upgrade":
                        upgrade_credibility(item["id"], "web_search_validation")
                        logger.info(f"Knowledge chunk {item['id']} upgraded to verified.")
                    elif action == "downgrade":
                        downgrade_credibility(item["id"])
                        logger.info(f"Knowledge chunk {item['id']} downgraded to unreliable.")
            except Exception as e:
                logger.error(f"Auto credibility check failed: {e}")
                
            return json.dumps(result, ensure_ascii=False)
        elif tool_name == "generate_learning_plan":
            # 局部导入，避免循环依赖
            from app.tools.plan_generator import generate_learning_plan
            topic = arguments.get("topic", "")
            days = arguments.get("days", 7)
            result = await generate_learning_plan(topic, days)
            return json.dumps(result, ensure_ascii=False)
        else:
            return json.dumps({"error": f"Unknown tool: {tool_name}"}, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Error executing tool {tool_name}: {str(e)}")
        return json.dumps({"error": str(e)}, ensure_ascii=False)

async def run_agent_with_tools(messages: list[dict], model: str | None = None) -> list[dict]:
    model = model or settings.DEFAULT_MODEL
    
    # ---------- 强制搜索拦截 ----------
    force_search = False
    conversation_summary = ""
    user_message = ""

    # 扫描并移除强制搜索标记
    for i, msg in enumerate(messages):
        if msg.get("role") == "system" and "【强制搜索指令】" in msg.get("content", ""):
            force_search = True
            messages.pop(i)
            break

    # 扫描并提取对话摘要
    for i, msg in enumerate(messages):
        if msg.get("role") == "system" and "【对话摘要】" in msg.get("content", ""):
            conversation_summary = msg["content"].replace("【对话摘要】", "").strip()
            messages.pop(i)
            break

    # 提取用户最后一条消息
    for msg in reversed(messages):
        if msg.get("role") == "user":
            user_message = msg["content"]
            break

    if force_search and user_message:
        # 构造搜索词：有摘要用摘要+用户消息，否则直接用用户消息
        if conversation_summary:
            search_query = f"{conversation_summary}\n用户问题：{user_message}"
        else:
            search_query = user_message

        logger.info(f"Force web search triggered, query: {search_query[:100]}...")
        search_result = await execute_tool('web_search', {'query': search_query})

        # 将搜索结果注入消息列表
        messages.append({
            "role": "system",
            "content": f"【强制搜索结果】\n{search_result}\n请根据以上联网搜索结果回答用户问题。"
        })
    # ------------------------------------
    
    for iteration in range(5):
        logger.info(f"[{model}] Agent loop iteration: {iteration + 1}")
        
        llm = await _get_client_for_model(model)
        response = await llm.chat.completions.create(
            model=model,
            messages=messages,
            tools=AVAILABLE_TOOLS
        )
        
        message = response.choices[0].message
        tool_calls = message.tool_calls
        
        if tool_calls:
            # 将 assistant 的 tool_call 消息追加到列表
            msg_dict = message.model_dump(exclude_none=True)
            messages.append(msg_dict)
            
            for tool_call in tool_calls:
                function_name = tool_call.function.name
                
                try:
                    arguments = json.loads(tool_call.function.arguments)
                except json.JSONDecodeError:
                    arguments = {}
                    
                tool_result = await execute_tool(function_name, arguments)
                
                # Check for credibility upgrade/downgrade
                if function_name == "web_search":
                    try:
                        web_results = json.loads(tool_result)
                        pending_items = []
                        
                        # Look for past search_knowledge_base results
                        for m in messages:
                            if m.get("role") == "tool" and m.get("name") == "search_knowledge_base":
                                kb_results = json.loads(m.get("content", "[]"))
                                for kb_item in kb_results:
                                    if kb_item.get("credibility") not in ("verified", "unreliable") and kb_item.get("id"):
                                        pending_items.append(kb_item)
                            
                            # Check system message for injected pending dicts
                            if m.get("role") == "system" and "待验证知识列表:" in str(m.get("content", "")):
                                try:
                                    content_str = str(m.get("content", ""))
                                    json_part = content_str.split("待验证知识列表: ")[1]
                                    injected_items = json.loads(json_part)
                                    pending_items.extend(injected_items)
                                except Exception as inner_e:
                                    logger.error(f"Error parsing pending docs from system message: {inner_e}")
                        
                        # 避免重复验证同一个 id
                        seen_ids = set()
                        for kb_item in pending_items:
                            kb_id = kb_item.get("id")
                            if kb_id in seen_ids:
                                continue
                            seen_ids.add(kb_id)
                            
                            credibility_action = await llm_evaluate_credibility(kb_item.get("content", ""), web_results)
                            if credibility_action == "upgrade":
                                knowledge.upgrade_credibility(kb_id, "web_search_validation")
                                logger.info(f"Knowledge chunk {kb_id} upgraded to verified status.")
                            elif credibility_action == "downgrade":
                                knowledge.downgrade_credibility(kb_id)
                                logger.info(f"Knowledge chunk {kb_id} downgraded to unreliable status.")
                    except Exception as e:
                        logger.error(f"Error checking upgrade/downgrade credibility: {e}")
                
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": function_name,
                    "content": tool_result,
                })
        else:
            # 无工具调用，这是最终回复
            msg_dict = message.model_dump(exclude_none=True)
            
            # 保护：确保 role 合法
            if msg_dict.get("role") not in ["assistant", "system", "user", "tool"]:
                logger.warning(f"Unexpected role '{msg_dict.get('role')}', defaulting to 'assistant'")
                msg_dict["role"] = "assistant"
            
            # 保护：确保 content 不为空
            if not msg_dict.get("content"):
                msg_dict["content"] = "抱歉，我无法处理这个请求。"
            
            messages.append(msg_dict)
            break
            
    return messages