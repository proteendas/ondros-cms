"""Shared FastAPI dependencies: DB session, current user, permission checks."""
import uuid

import jwt as pyjwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.database import get_db
from app.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        user_id = uuid.UUID(payload["sub"])
    except (pyjwt.PyJWTError, KeyError, ValueError):
        raise credentials_error

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise credentials_error
    return user


def require_permission(permission: str):
    """Dependency factory for role-based checks.

    Usage: Depends(require_permission("entries:publish"))
    Roles with "*" bypass all checks. Extend with resource-level rules as needed.
    """

    async def checker(user: User = Depends(get_current_user)) -> User:
        perms: list[str] = user.role.permissions if user.role else []
        if "*" not in perms and permission not in perms:
            raise HTTPException(status_code=403, detail=f"Missing permission: {permission}")
        return user

    return checker
