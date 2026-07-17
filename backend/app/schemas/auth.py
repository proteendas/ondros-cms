import uuid

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    # Optional: log straight into a specific account the user belongs to.
    account_id: uuid.UUID | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenPairResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    account_id: uuid.UUID


class SignupRequest(BaseModel):
    account_name: str = Field(min_length=2, max_length=200)
    account_slug: str = Field(pattern=r"^[a-z0-9][a-z0-9\-]*$", max_length=100)
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = ""


class SignupResponse(BaseModel):
    account_id: uuid.UUID
    user_id: uuid.UUID
    message: str
    # Present only when AUTH_DEV_MODE (no SMTP configured locally).
    dev_verification_token: str | None = None


class VerifyEmailRequest(BaseModel):
    token: str


class RefreshRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    message: str
    dev_reset_token: str | None = None  # AUTH_DEV_MODE only


class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(min_length=8)


class SwitchAccountRequest(BaseModel):
    account_id: uuid.UUID


class UserRoleInfo(BaseModel):
    role_name: str
    space_id: uuid.UUID | None = None  # None = organization-wide


class AccountInfo(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    is_owner: bool = False
    is_active: bool = False  # the account this token is scoped to


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    tenant_id: uuid.UUID  # active account id
    roles: list[UserRoleInfo] = []
    # Capability set for the ACTIVE account (space-scoped capabilities are
    # checked server-side per request; the editor uses this for menu visibility).
    capabilities: list[str] = []
    accounts: list[AccountInfo] = []

    model_config = {"from_attributes": True}
