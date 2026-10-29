"""File encryption — envelope encryption with chunked streaming, built on the
same AES-256-GCM/HKDF-SHA256 primitives as core/vault.py (the Password
Vault), extended because files can be multi-megabyte and a single GCM call
over the whole plaintext in memory doesn't work at that size.

Key hierarchy:
  - A fresh random 32-byte data-encryption-key (DEK) per file.
  - The DEK is "wrapped" (encrypted) with a key derived from the app's
    VAULT_MASTER_KEY via HKDF — one small AESGCM call, since the DEK itself
    is tiny. wrap_dek/unwrap_dek store/recover it.
  - The file body is encrypted with the DEK in fixed 1 MiB chunks, each
    independently authenticated. Chunk framing on disk is
    [4-byte big-endian ciphertext length][ciphertext+tag], repeated, so
    decryption can stream one chunk at a time without ever holding the
    whole file in memory. Each chunk's nonce is the file's own random
    8-byte base IV concatenated with a 4-byte big-endian chunk counter
    (12 bytes total, as AESGCM requires) — unique per chunk within a file,
    never reused.

Pure-ish functions with no FastAPI dependencies (file I/O aside) — import
these into services only, same convention as core/vault.py.
"""
import base64
import os
import struct
from typing import AsyncIterator

import aiofiles
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

_CHUNK_SIZE = 1024 * 1024  # 1 MiB of plaintext per chunk
_LENGTH_PREFIX_SIZE = 4


def _wrap_key(master_key_b64: str) -> bytes:
    master_key = base64.b64decode(master_key_b64)
    return HKDF(
        algorithm=SHA256(),
        length=32,
        salt=b"file-vault-wrap",
        info=b"file-vault",
    ).derive(master_key)


def generate_dek() -> bytes:
    """A fresh random 256-bit data-encryption-key for one file."""
    return os.urandom(32)


def wrap_dek(master_key_b64: str, dek: bytes) -> tuple[str, str]:
    """Encrypts a file's DEK with a key derived from the master key.

    Returns:
        (wrapped_dek_b64, dek_iv_b64) — both stored on the FileEntry record.
    """
    key = _wrap_key(master_key_b64)
    iv = os.urandom(12)
    wrapped = AESGCM(key).encrypt(iv, dek, None)
    return base64.b64encode(wrapped).decode(), base64.b64encode(iv).decode()


def unwrap_dek(master_key_b64: str, wrapped_dek_b64: str, dek_iv_b64: str) -> bytes:
    """Recovers a file's DEK. Raises cryptography.exceptions.InvalidTag if
    wrapped_dek/dek_iv have been tampered with."""
    key = _wrap_key(master_key_b64)
    iv = base64.b64decode(dek_iv_b64)
    wrapped = base64.b64decode(wrapped_dek_b64)
    return AESGCM(key).decrypt(iv, wrapped, None)


async def encrypt_file(dek: bytes, src_path: str, dest_path: str) -> str:
    """Reads plaintext from src_path (a local file, e.g. an upload's
    temp-staging copy), writes AEAD-framed encrypted chunks to dest_path.
    Bounded memory use regardless of file size — never holds more than one
    chunk at a time.

    Returns:
        file_iv_b64 — the base64-encoded 8-byte base IV used, store this on
        the FileEntry record as file_iv.
    """
    file_iv = os.urandom(8)
    aesgcm = AESGCM(dek)
    chunk_index = 0
    async with aiofiles.open(src_path, "rb") as src, aiofiles.open(dest_path, "wb") as dest:
        while True:
            chunk = await src.read(_CHUNK_SIZE)
            if not chunk:
                break
            nonce = file_iv + struct.pack(">I", chunk_index)
            ciphertext = aesgcm.encrypt(nonce, chunk, None)
            await dest.write(struct.pack(">I", len(ciphertext)))
            await dest.write(ciphertext)
            chunk_index += 1
    return base64.b64encode(file_iv).decode()


async def decrypt_file_stream(dek: bytes, file_iv_b64: str, path: str) -> AsyncIterator[bytes]:
    """Async generator yielding decrypted plaintext chunks, reading exactly
    one framed ciphertext chunk at a time from disk. Raises
    cryptography.exceptions.InvalidTag on any tampered/corrupt chunk —
    authenticated, not just encrypted."""
    file_iv = base64.b64decode(file_iv_b64)
    aesgcm = AESGCM(dek)
    chunk_index = 0
    async with aiofiles.open(path, "rb") as f:
        while True:
            length_bytes = await f.read(_LENGTH_PREFIX_SIZE)
            if not length_bytes:
                break
            if len(length_bytes) < _LENGTH_PREFIX_SIZE:
                raise ValueError("Corrupt encrypted file: truncated length prefix")
            (length,) = struct.unpack(">I", length_bytes)
            ciphertext = await f.read(length)
            if len(ciphertext) < length:
                raise ValueError("Corrupt encrypted file: truncated chunk")
            nonce = file_iv + struct.pack(">I", chunk_index)
            yield aesgcm.decrypt(nonce, ciphertext, None)
            chunk_index += 1
