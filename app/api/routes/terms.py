from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlmodel import select

from app.api.deps import SessionDep, get_current_user, require_admin
from app.core.security import utc_now
from app.models import TermsApplicability, TermsTemplate
from app.schemas import TermsTemplateCreate, TermsTemplateRead, TermsTemplateUpdate

router = APIRouter(prefix="/api/terms", tags=["terms"], dependencies=[Depends(get_current_user)])


def _clean_text(value: str, label: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise HTTPException(status_code=422, detail=f"{label} is required")
    return cleaned


def _duplicate_name(session: SessionDep, name: str, exclude_id: int | None = None) -> bool:
    statement = select(TermsTemplate.id).where(func.lower(TermsTemplate.name) == name.lower())
    if exclude_id is not None:
        statement = statement.where(TermsTemplate.id != exclude_id)
    return session.exec(statement).first() is not None


@router.get("", response_model=dict)
def list_terms_templates(
    session: SessionDep,
    applies_to: TermsApplicability | None = Query(default=None),
) -> dict:
    statement = select(TermsTemplate)
    if applies_to in {TermsApplicability.quote, TermsApplicability.invoice}:
        statement = statement.where(
            (TermsTemplate.applies_to == applies_to) | (TermsTemplate.applies_to == TermsApplicability.both)
        )
    rows = session.exec(statement.order_by(func.lower(TermsTemplate.name))).all()
    return {"items": [TermsTemplateRead.model_validate(row).model_dump(mode="json") for row in rows]}


@router.post(
    "",
    response_model=TermsTemplateRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def create_terms_template(payload: TermsTemplateCreate, session: SessionDep) -> TermsTemplate:
    name = _clean_text(payload.name, "Template name")
    content = _clean_text(payload.content, "Template content")
    if _duplicate_name(session, name):
        raise HTTPException(status_code=400, detail="A terms template with this name already exists")
    now = utc_now()
    row = TermsTemplate(name=name, applies_to=payload.applies_to, content=content, created_at=now, updated_at=now)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.patch("/{template_id}", response_model=TermsTemplateRead, dependencies=[Depends(require_admin)])
def update_terms_template(template_id: int, payload: TermsTemplateUpdate, session: SessionDep) -> TermsTemplate:
    row = session.get(TermsTemplate, template_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Terms template not found")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        data["name"] = _clean_text(data["name"], "Template name")
        if _duplicate_name(session, data["name"], exclude_id=template_id):
            raise HTTPException(status_code=400, detail="A terms template with this name already exists")
    if "content" in data:
        data["content"] = _clean_text(data["content"], "Template content")
    for key, value in data.items():
        setattr(row, key, value)
    row.updated_at = utc_now()
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.delete("/{template_id}", response_model=dict, dependencies=[Depends(require_admin)])
def delete_terms_template(template_id: int, session: SessionDep) -> dict[str, str]:
    row = session.get(TermsTemplate, template_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Terms template not found")
    session.delete(row)
    session.commit()
    return {"message": "Terms template deleted"}
