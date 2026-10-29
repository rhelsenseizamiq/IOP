"""Unit tests for file_vault's envelope encryption (DEK wrap/unwrap +
chunked file encryption/decryption)."""
import base64
import os
import tempfile

import pytest
from cryptography.exceptions import InvalidTag

from app.core.file_vault import (
    decrypt_file_stream,
    encrypt_file,
    generate_dek,
    unwrap_dek,
    wrap_dek,
)

MASTER_KEY = base64.b64encode(b"B" * 32).decode()
OTHER_MASTER_KEY = base64.b64encode(b"C" * 32).decode()


# ── DEK wrap/unwrap ─────────────────────────────────────────────────────

def test_dek_wrap_roundtrip():
    dek = generate_dek()
    wrapped, iv = wrap_dek(MASTER_KEY, dek)
    assert unwrap_dek(MASTER_KEY, wrapped, iv) == dek


def test_dek_is_32_bytes():
    assert len(generate_dek()) == 32


def test_dek_unique_per_call():
    assert generate_dek() != generate_dek()


def test_wrapped_dek_wrong_master_key_fails():
    dek = generate_dek()
    wrapped, iv = wrap_dek(MASTER_KEY, dek)
    with pytest.raises((InvalidTag, Exception)):
        unwrap_dek(OTHER_MASTER_KEY, wrapped, iv)


def test_wrap_dek_unique_iv_per_call():
    dek = generate_dek()
    _, iv1 = wrap_dek(MASTER_KEY, dek)
    _, iv2 = wrap_dek(MASTER_KEY, dek)
    assert iv1 != iv2


# ── Chunked file encryption/decryption ──────────────────────────────────

async def _roundtrip(plaintext: bytes) -> bytes:
    dek = generate_dek()
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "src.bin")
        dest = os.path.join(tmp, "dest.enc")
        with open(src, "wb") as f:
            f.write(plaintext)
        file_iv = await encrypt_file(dek, src, dest)
        out = bytearray()
        async for chunk in decrypt_file_stream(dek, file_iv, dest):
            out.extend(chunk)
        return bytes(out)


@pytest.mark.asyncio
async def test_small_file_roundtrip():
    assert await _roundtrip(b"hello world") == b"hello world"


@pytest.mark.asyncio
async def test_empty_file_roundtrip():
    assert await _roundtrip(b"") == b""


@pytest.mark.asyncio
async def test_exact_chunk_boundary_roundtrip():
    # Exactly one chunk (1 MiB) — verifies chunk-boundary framing doesn't
    # off-by-one at the edge.
    data = os.urandom(1024 * 1024)
    assert await _roundtrip(data) == data


@pytest.mark.asyncio
async def test_multi_chunk_roundtrip():
    # 2.5 chunks — verifies the per-chunk nonce counter is correctly
    # incremented across multiple chunks, not reused.
    data = os.urandom(int(1024 * 1024 * 2.5))
    assert await _roundtrip(data) == data


@pytest.mark.asyncio
async def test_tampered_chunk_detected():
    dek = generate_dek()
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "src.bin")
        dest = os.path.join(tmp, "dest.enc")
        with open(src, "wb") as f:
            f.write(b"authenticated data, do not tamper")
        file_iv = await encrypt_file(dek, src, dest)

        with open(dest, "r+b") as f:
            f.seek(10)
            byte = f.read(1)
            f.seek(10)
            f.write(bytes([byte[0] ^ 0xFF]))

        with pytest.raises((InvalidTag, Exception)):
            async for _ in decrypt_file_stream(dek, file_iv, dest):
                pass


@pytest.mark.asyncio
async def test_wrong_dek_fails():
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "src.bin")
        dest = os.path.join(tmp, "dest.enc")
        with open(src, "wb") as f:
            f.write(b"secret contents")
        file_iv = await encrypt_file(generate_dek(), src, dest)
        with pytest.raises((InvalidTag, Exception)):
            async for _ in decrypt_file_stream(generate_dek(), file_iv, dest):
                pass


@pytest.mark.asyncio
async def test_file_iv_unique_per_encryption():
    dek = generate_dek()
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "src.bin")
        with open(src, "wb") as f:
            f.write(b"same plaintext")
        iv1 = await encrypt_file(dek, src, os.path.join(tmp, "a.enc"))
        iv2 = await encrypt_file(dek, src, os.path.join(tmp, "b.enc"))
        assert iv1 != iv2
