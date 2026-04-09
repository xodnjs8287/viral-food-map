from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import Header, HTTPException, status

from database import get_client

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class AdminUser:
    id: str
    email: str


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="관리자 로그인 토큰이 필요합니다.",
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효한 Bearer 토큰이 필요합니다.",
        )

    return token.strip()


async def require_admin_user(
    authorization: str | None = Header(default=None),
) -> AdminUser:
    token = _extract_bearer_token(authorization)

    try:
        user_response = get_client().auth.get_user(token)
    except Exception as exc:
        logger.warning("Admin auth token verification failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인 세션을 확인할 수 없습니다. 다시 로그인해 주세요.",
        ) from exc

    user = user_response.user if user_response else None
    email = (getattr(user, "email", None) or "").strip().lower()
    app_metadata = getattr(user, "app_metadata", {}) or {}
    role = str(app_metadata.get("role", "")).strip().lower()
    if not user or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인 세션을 확인할 수 없습니다. 다시 로그인해 주세요.",
        )

    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자 권한이 필요합니다.",
        )

    return AdminUser(id=str(user.id), email=email)
