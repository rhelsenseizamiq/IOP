"""Unit tests for the AI assistant's "who is X" person-lookup feature
(app/routers/assistant.py).

Deliberately tests only the two pure functions — the role gate
(_can_lookup_people) and the question-phrase parser
(_extract_person_query) — not the full /assistant/ask endpoint, which
would need a real or mocked Ollama round trip for the non-admin
fallback path. These two functions are exactly where the feature's
real risk lives: a wrong role check would leak Administrator-only user
data (role, email, cabinet membership) to a Viewer/Operator via this
chat as a side channel, and the regex is what had two real reported
bugs on day one (numeric usernames like "008162" excluded, and a
missing approval_status default mislabeling the seeded admin account
as "pending approval").
"""
import pytest

from app.models.user import Role
from app.routers.assistant import _can_lookup_people, _extract_person_query


@pytest.mark.parametrize(
    "role,expected",
    [
        (Role.VIEWER, False),
        (Role.OPERATOR, False),
        (Role.ADMINISTRATOR, True),
        (Role.SUPER_ADMIN, True),
    ],
)
def test_can_lookup_people_role_gate(role, expected):
    assert _can_lookup_people(role) is expected


def test_extract_person_query_numeric_username():
    # Real usernames here are often employee IDs — a letter-only first
    # character in the regex silently excluded every one of them.
    assert _extract_person_query("who is 008162") == "008162"


def test_extract_person_query_full_name():
    assert (
        _extract_person_query("last login for Ismayil Heydarov")
        == "Ismayil Heydarov"
    )


def test_extract_person_query_tell_me_about_user():
    assert _extract_person_query("tell me about user jsmith") == "jsmith"


def test_extract_person_query_strips_trailing_punctuation():
    assert _extract_person_query("who is admin?") == "admin"


def test_extract_person_query_role_phrasing():
    assert _extract_person_query("what's the role of 002343") == "002343"


def test_extract_person_query_no_match_returns_none():
    assert _extract_person_query("what's the gateway for 172.31.4.0/24") is None
    assert _extract_person_query("show me free ip from test subnet") is None
