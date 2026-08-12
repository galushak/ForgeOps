from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlmodel import Session, select

from app.core.config import get_settings
from app.core.security import hash_password, new_token, utc_expires, utc_now, verify_password
from app.db import get_session
from app.models import SessionToken, User
from app.api.deps import get_current_user
from app.schemas import LoginRequest, UserProfileRead, UserProfileUpdate

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()


@router.post("/login")
def login(payload: LoginRequest, response: Response, session: Session = Depends(get_session)) -> dict[str, str]:
    user = session.exec(select(User).where(User.email == payload.email.lower().strip())).first()
    if user is None or not verify_password(payload.password, user.password_hash):
        response.status_code = 401
        return {"message": "Invalid email or password"}
    days = settings.session_days if payload.remember_me else 1
    token = new_token()
    session.add(SessionToken(token=token, user_id=user.id or 0, created_at=utc_now(), expires_at=utc_expires(days)))
    session.commit()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        httponly=True,
        secure=settings.app_env == "production",
        samesite="lax",
        max_age=days * 24 * 60 * 60,
    )
    return {"message": "Logged in"}


@router.post("/logout")
def logout(response: Response) -> dict[str, str]:
    response.delete_cookie(settings.session_cookie_name)
    return {"message": "Logged out"}


@router.get("/me", response_model=UserProfileRead)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.patch("/me", response_model=UserProfileRead)
def update_me(
    payload: UserProfileUpdate,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> User:
    if payload.email is not None:
        new_email = payload.email.lower().strip()
        if not new_email or "@" not in new_email:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Enter a valid email address")
        existing = session.exec(select(User).where(User.email == new_email, User.id != user.id)).first()
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That email is already in use")
        user.email = new_email

    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()

    if payload.new_password:
        if not payload.current_password or not verify_password(payload.current_password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is required to change your password")
        user.password_hash = hash_password(payload.new_password)

    session.add(user)
    session.commit()
    session.refresh(user)
    return user
