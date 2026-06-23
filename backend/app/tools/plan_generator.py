import logging
import json as json_lib
from openai import AsyncOpenAI
from app.config import settings

logger = logging.getLogger(__name__)

# 自己创建客户端，避免循环导入
client = AsyncOpenAI(
    api_key=settings.LLM_API_KEY,
    base_url=settings.LLM_BASE_URL
)

async def generate_learning_plan(topic: str, days: int = 7) -> dict:
    """生成学习计划并自动保存到数据库"""
    prompt = f"""你是一个专业的学习规划助手。请为用户生成一个 {days} 天的学习计划，主题是：{topic}。
要求：
1. 输出必须是一个严格的 JSON 对象，包含以下字段：
   - title: 计划标题
   - overview: 计划概述（100字以内）
   - days: 数组，每个元素包含 day(天数)、topic(当天主题)、concepts(关键概念，数组)、tasks(实践任务，数组)、resources(推荐资源，数组)
2. 只输出 JSON，不要包含任何额外的解释或 markdown 格式。
3. 确保 JSON 可被直接解析。"""

    try:
        response = await client.chat.completions.create(
            model=settings.DEFAULT_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            stream=False
        )
        content = response.choices[0].message.content.strip()
        # 尝试解析 JSON
        result = json_lib.loads(content)
    except Exception as e:
        logger.error(f"生成计划失败：{e}，原始内容：{content if 'content' in dir() else '无'}")
        return {"title": "生成失败", "overview": str(e), "days": []}

    # === 自动保存到数据库 ===
    try:
        from app.database import SessionLocal
        from app.models.plan import LearningPlan

        db = SessionLocal()
        plan_record = LearningPlan(
            title=result.get("title", "未命名计划"),
            overview=result.get("overview", ""),
            content=json_lib.dumps(result, ensure_ascii=False)
        )
        db.add(plan_record)
        db.commit()
        logger.info(f"学习计划已保存，ID={plan_record.id}")
    except Exception as e:
        logger.error(f"保存学习计划失败：{e}")
    finally:
        try:
            db.close()
        except:
            pass

    return result