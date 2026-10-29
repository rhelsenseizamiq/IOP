"""
Per-user AI assistant conversation history (`assistant_messages`) plus a
per-user "current session" pointer (`assistant_sessions`).

Messages: one document per message (same shape as audit_logs /
paloalto_check_logs in this codebase), not a single growing array field
per user — avoids the classic MongoDB anti-pattern of an unbounded array
eventually hitting the 16MB document size limit for a heavy user, and
makes "give me the last N messages" a plain indexed query instead of an
in-app slice.

Sessions: each message is tagged with a `session_id`. "Start a new
conversation" doesn't delete anything — it just points the user's
`current_session_id` at a fresh UUID, so old messages stay in the
database under their old session_id while the "current" view only shows
what's tagged with the new one. Actually deleting a conversation
(delete_session below) is a separate, explicit action — only ever
triggered by the user directly clicking delete on that specific
conversation, never automatically.

Every read/write here is scoped by `username`, taken from the caller's
own authenticated token (never a client-supplied value) — this is the
entire security boundary that keeps one user's chat history private from
another (see assistant.py: every call passes `current_user.sub`).
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorCollection


class ConversationRepository:
    def __init__(
        self, messages: AsyncIOMotorCollection, sessions: AsyncIOMotorCollection,
    ) -> None:
        self._messages = messages
        self._sessions = sessions

    async def get_or_create_session(self, username: str) -> str:
        doc = await self._sessions.find_one({"_id": username})
        if doc:
            return doc["current_session_id"]
        return await self.start_new_session(username)

    async def start_new_session(self, username: str) -> str:
        session_id = str(uuid.uuid4())
        await self._sessions.update_one(
            {"_id": username},
            {"$set": {
                "current_session_id": session_id,
                "updated_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
        return session_id

    async def append(
        self,
        username: str,
        session_id: str,
        role: str,
        text: str,
        sources: Optional[list[dict]] = None,
    ) -> None:
        await self._messages.insert_one({
            "username": username,
            "session_id": session_id,
            "role": role,
            "text": text,
            "sources": sources,
            "created_at": datetime.now(timezone.utc),
        })

    async def list_for_session(
        self, username: str, session_id: str, limit: int = 100,
    ) -> list[dict]:
        """Returns the most recent `limit` messages for this user's
        current session, oldest first (chat display order) — fetches
        newest-first from Mongo then reverses, so the limit actually
        caps at the *recent* end rather than silently truncating from
        the start of a long conversation."""
        cursor = (
            self._messages.find({"username": username, "session_id": session_id})
            .sort("created_at", -1)
            .limit(limit)
        )
        docs = await cursor.to_list(length=limit)
        docs.reverse()
        return docs

    async def last_user_message(self, username: str, session_id: str) -> Optional[str]:
        """The most recent USER-role message text in this session — used
        to resolve a short follow-up ("try again", "check again") that
        has no IP/subnet/keyword of its own by carrying the previous
        question's content forward. Returns None for a brand-new session
        with nothing to follow up on yet."""
        doc = await self._messages.find_one(
            {"username": username, "session_id": session_id, "role": "user"},
            sort=[("created_at", -1)],
        )
        return doc["text"] if doc else None

    async def list_sessions(self, username: str, limit: int = 50) -> list[dict]:
        """Every past conversation for this user, most recently active
        first — one entry per session_id, with a preview (the session's
        first message, always the user's own opening question since
        append() always writes user-then-assistant) and when it was last
        active. Powers the "old conversations" sidebar: sort ascending
        first so $first/$last reflect chronological order within each
        group, per MongoDB's documented $group accumulator behavior."""
        pipeline = [
            {"$match": {"username": username}},
            {"$sort": {"created_at": 1}},
            {"$group": {
                "_id": "$session_id",
                "preview": {"$first": "$text"},
                "last_message_at": {"$last": "$created_at"},
                "message_count": {"$sum": 1},
            }},
            {"$sort": {"last_message_at": -1}},
            {"$limit": limit},
        ]
        cursor = self._messages.aggregate(pipeline)
        return await cursor.to_list(length=limit)

    async def session_belongs_to_user(self, username: str, session_id: str) -> bool:
        return await self._messages.count_documents(
            {"username": username, "session_id": session_id}, limit=1,
        ) > 0

    async def switch_session(self, username: str, session_id: str) -> None:
        """Makes an existing (already-owned) session the current one —
        used when the user clicks an old conversation in the sidebar to
        continue it. Doesn't touch message data at all."""
        await self._sessions.update_one(
            {"_id": username},
            {"$set": {
                "current_session_id": session_id,
                "updated_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )

    async def delete_session(self, username: str, session_id: str) -> int:
        """Permanently deletes every message in this conversation for
        this user. Scoped by username, same as every other method here —
        the caller (assistant.py) also checks session_belongs_to_user
        first so a 404 is returned instead of a silent no-op delete for
        a session that isn't this user's."""
        result = await self._messages.delete_many(
            {"username": username, "session_id": session_id},
        )
        return result.deleted_count

    async def is_current_session(self, username: str, session_id: str) -> bool:
        doc = await self._sessions.find_one({"_id": username})
        return bool(doc and doc.get("current_session_id") == session_id)
