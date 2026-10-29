"""Unit tests for the mandatory file-upload expiry (validate_expires_at).

The uploader must explicitly choose a deletion date for their own file,
capped at 30 days — see app/services/file_service.py's module docstring.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.services.file_service import MAX_FILE_RETENTION, validate_expires_at


def test_accepts_a_date_within_30_days():
    target = datetime.now(timezone.utc) + timedelta(days=10)
    result = validate_expires_at(target)
    assert result == target


def test_rejects_a_past_date():
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    with pytest.raises(HTTPException) as exc:
        validate_expires_at(past)
    assert exc.value.status_code == 422


def test_rejects_exactly_now():
    with pytest.raises(HTTPException) as exc:
        validate_expires_at(datetime.now(timezone.utc))
    assert exc.value.status_code == 422


def test_rejects_more_than_30_days_out():
    too_far = datetime.now(timezone.utc) + MAX_FILE_RETENTION + timedelta(days=1)
    with pytest.raises(HTTPException) as exc:
        validate_expires_at(too_far)
    assert exc.value.status_code == 422


def test_accepts_exactly_30_days_out():
    boundary = datetime.now(timezone.utc) + MAX_FILE_RETENTION
    result = validate_expires_at(boundary)
    assert result == boundary


def test_normalizes_naive_datetime_to_utc():
    # Same Mongo-naive-datetime trap already fixed on ShareLink/FileEntry/
    # User — this runs on the raw Form value before it round-trips through
    # Mongo, so it needs its own normalization here too.
    naive_future = (datetime.now(timezone.utc) + timedelta(days=5)).replace(tzinfo=None)
    result = validate_expires_at(naive_future)
    assert result.tzinfo is not None
