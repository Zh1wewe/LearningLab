from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.plan import LearningPlan
from pydantic import BaseModel
from datetime import datetime

router = APIRouter()

class PlanResponse(BaseModel):
    id: int
    title: str
    overview: str | None = None
    content: str
    created_at: datetime
    updated_at: datetime

class PlanListResponse(BaseModel):
    id: int
    title: str
    created_at: datetime

    class Config:
        orm_mode = True

@router.get("/list", response_model=List[PlanListResponse])
def get_plans(db: Session = Depends(get_db)):
    plans = db.query(LearningPlan).order_by(LearningPlan.created_at.desc()).all()
    return plans

@router.get("/{plan_id}", response_model=PlanResponse)
def get_plan(plan_id: int, db: Session = Depends(get_db)):
    plan = db.query(LearningPlan).filter(LearningPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan

@router.delete("/{plan_id}")
def delete_plan(plan_id: int, db: Session = Depends(get_db)):
    plan = db.query(LearningPlan).filter(LearningPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    db.delete(plan)
    db.commit()
    return {"status": "ok", "message": "Plan deleted"}
