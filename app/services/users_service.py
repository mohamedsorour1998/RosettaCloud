"""
users_service – unified async interface to user management.

Select the concrete backend with:
    export USERS_BACKEND=dynamodb   # default
    export USERS_BACKEND=lms        # new LMS-based backend
"""
from __future__ import annotations

import importlib
import logging
import os
from typing import Any, Dict, List, Optional, Protocol


class _Backend(Protocol):
    async def init(self) -> None: ...
    async def close(self) -> None: ...
    async def create_user(self, user_data: Dict[str, Any]) -> Dict[str, Any]: ...
    async def get_user(self, user_id: str) -> Optional[Dict[str, Any]]: ...
    async def get_user_by_email(self, email: str) -> Optional[Dict[str, Any]]: ...
    async def update_user(self, user_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]: ...
    async def delete_user(self, user_id: str) -> bool: ...
    async def list_users(self, limit: int = 100, last_key: Optional[str] = None) -> Dict[str, Any]: ...
    async def link_lab_to_user(self, user_id: str, lab_id: str) -> bool: ...
    async def unlink_lab_from_user(self, user_id: str, lab_id: str) -> bool: ...
    async def get_user_labs(self, user_id: str) -> List[str]: ...
    async def track_user_progress(self, user_id: str, module_uuid: str, lesson_uuid: str, question_number: int, completed: bool) -> bool: ...
    async def get_user_progress(self, user_id: str, module_uuid: Optional[str] = None, lesson_uuid: Optional[str] = None) -> Dict[str, Any]: ...


_backend_name = os.getenv("USERS_BACKEND", "dynamodb").lower()
_impl_mod = importlib.import_module("app.backends.users_backends")

# Add validation for backend name
valid_backends = ["dynamodb", "lms"]  # Add lms to the list of valid backends
if _backend_name not in valid_backends:
    raise ValueError(f"Unknown users backend: {_backend_name}. Valid options are: {', '.join(valid_backends)}")

_IMPL: _Backend = getattr(_impl_mod, f"get_{_backend_name}_backend")()

logging.getLogger(__name__).info("users_service backend: %s", _backend_name)

init = _IMPL.init
close = _IMPL.close
create_user = _IMPL.create_user
get_user = _IMPL.get_user
get_user_by_email = _IMPL.get_user_by_email
update_user = _IMPL.update_user
delete_user = _IMPL.delete_user
list_users = _IMPL.list_users
link_lab_to_user = _IMPL.link_lab_to_user
unlink_lab_from_user = _IMPL.unlink_lab_from_user
get_user_labs = _IMPL.get_user_labs
track_user_progress = _IMPL.track_user_progress
get_user_progress = _IMPL.get_user_progress