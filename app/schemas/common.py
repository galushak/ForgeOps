from pydantic import BaseModel, Field


class PageMeta(BaseModel):
    page: int
    page_size: int
    total: int


class Page(BaseModel):
    items: list[dict]
    meta: PageMeta


class Message(BaseModel):
    message: str


class LoginRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(min_length=8, max_length=200)
    remember_me: bool = False


class SetupAccountRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    email: str = Field(max_length=255)
    password: str = Field(min_length=8, max_length=200)


class UserProfileRead(BaseModel):
    id: int
    email: str
    full_name: str
    is_admin: bool


class UserProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    email: str | None = Field(default=None, max_length=255)
    current_password: str | None = Field(default=None, max_length=200)
    new_password: str | None = Field(default=None, min_length=8, max_length=200)
