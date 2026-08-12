from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import func, select

from app.api.deps import SessionDep, get_current_user
from app.core.security import utc_now
from app.models import Client, LaborEntry, LedgerEntry, Project
from app.schemas import ProjectCreate, ProjectRead, ProjectUpdate

router = APIRouter(prefix="/api/projects", tags=["projects"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=dict)
def list_projects(
    session: SessionDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    client_id: int | None = None,
) -> dict:
    stmt = select(Project)
    count_stmt = select(func.count(Project.id))
    if client_id is not None:
        stmt = stmt.where(Project.client_id == client_id)
        count_stmt = count_stmt.where(Project.client_id == client_id)
    total = session.exec(count_stmt).one()
    items = session.exec(stmt.order_by(Project.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {
        "items": [ProjectRead.model_validate(i).model_dump(mode="json") for i in items],
        "meta": {"page": page, "page_size": page_size, "total": total},
    }


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, session: SessionDep) -> Project:
    if session.get(Client, payload.client_id) is None:
        raise HTTPException(status_code=400, detail="Client does not exist")
    now = utc_now()
    project = Project(**payload.model_dump(), created_at=now, updated_at=now)
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@router.patch("/{project_id}", response_model=ProjectRead)
def update_project(project_id: int, payload: ProjectUpdate, session: SessionDep) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    data = payload.model_dump(exclude_unset=True)
    if "client_id" in data and session.get(Client, data["client_id"]) is None:
        raise HTTPException(status_code=400, detail="Client does not exist")
    for key, value in data.items():
        setattr(project, key, value)
    project.updated_at = utc_now()
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@router.delete("/{project_id}", response_model=dict)
def delete_project(project_id: int, session: SessionDep) -> dict[str, str]:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    has_ledger = session.exec(select(func.count(LedgerEntry.id)).where(LedgerEntry.project_id == project_id)).one()
    has_labor = session.exec(select(func.count(LaborEntry.id)).where(LaborEntry.project_id == project_id)).one()
    if has_ledger or has_labor:
        raise HTTPException(
            status_code=400, detail="Project has ledger or labor entries. Mark it canceled/completed instead."
        )
    session.delete(project)
    session.commit()
    return {"message": "Project deleted"}
