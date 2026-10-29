"""
Offline AI assistant — talks to Ollama running natively on the host
(172.18.0.1:11434, the iop-external Docker bridge's own gateway address;
never exposed on a public interface). Two models are used:

- OLLAMA_EMBED_MODEL (nomic-embed-text): turns a short text blurb into a
  768-dim vector. Embeddings are L2-normalized here so that a plain dot
  product IS the cosine similarity — lets the similarity search live
  entirely in a MongoDB aggregation pipeline (see
  embedding_repository.py) with no extra Python dependency (no numpy;
  the running container's image can't be rebuilt on this no-internet
  host, so anything not already in requirements.txt has to be avoidable,
  not hot-installed).
- OLLAMA_CHAT_MODEL (Llama 3.1 8B Instruct): answers a question given
  retrieved IP-record context (retrieval-augmented generation — the model
  otherwise has no idea what's in this IPAM's database and would just
  hallucinate about it).

Both calls have a connect-timeout split from the read-timeout, same
rationale as vsphere_service.py / paloalto — a slow/unreachable local
model server should fail fast, not hang the request.
"""
import asyncio
import logging
import math
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_CONNECT_TIMEOUT = 5.0
# UPDATED 2026-09-23 after the host was resized 8→16 cores / 15→31GB RAM.
# The original numbers here (kept below for history) were measured on a
# 2012 Xeon E5-2670 with no AVX2/FMA — genuinely slow, not under-tuned.
# Re-measured live on the resized host, warm model, real prompts:
#   - PROMPT processing: ~1.1 tok/s  → ~34 tok/s   (≈30x)
#   - generation:        ~0.18 tok/s → ~6.4 tok/s  (≈35x)
# Timeout and token-budget limits below are relaxed accordingly. This
# does NOT change anywhere the LLM was kept out of a path for a
# *correctness* reason rather than a speed reason (free-address lists,
# server status, live IP checks, fleet stats in assistant.py all stay
# 100% deterministic — a quantized 8B model mis-stating a number was
# never a speed problem and isn't fixed by faster hardware).
_EMBED_READ_TIMEOUT = 45.0
# Sized with real safety margin above the ~34 tok/s / ~6.4 tok/s measured
# numbers (a single, small sample — real traffic can be slower under
# contention), not shaved down to the measured minimum: a worst-case
# ~800-token prompt + this file's new 200-token response budget is only
# ~55s of pure inference at those rates, so 180s leaves >3x headroom
# while still being a massive cut from the old 900s, which existed only
# to survive the old hardware's ~135s-per-150-prompt-tokens reality.
_CHAT_READ_TIMEOUT = 180.0
# Raised from 60 now that generation is ~35x faster (200 tokens costs
# ~31s at the new measured rate, vs. ~5.5 *minutes* at the old one) —
# lets ordinary Q&A give a genuinely complete answer instead of being
# cut off after a sentence. Callers needing a real long response (the
# free-address list case) still pass their own smaller max_tokens and
# append the actual data in code rather than asking the model to
# regenerate it — that's a correctness choice, not a speed one, and
# didn't change.
_MAX_RESPONSE_TOKENS = 200


# Reliability: one bounded retry, but ONLY for a connect-level failure
# (Ollama briefly unreachable — the native systemd service mid-restart,
# or momentarily between requests right as OLLAMA_KEEP_ALIVE expires and
# it's about to reload a model). Deliberately NOT retried: a read
# timeout (the full _CHAT_READ_TIMEOUT/_EMBED_READ_TIMEOUT already
# elapsed — retrying just doubles the wait for likely the same result)
# or an HTTP error status (a real error — bad request, missing model —
# that a retry can't fix). Retrying blindly on every failure would mask
# genuine problems as slowness instead of surfacing them.
_CONNECT_RETRY_ATTEMPTS = 2
_CONNECT_RETRY_DELAY_SECONDS = 2.0


async def _post_with_retry(client: httpx.AsyncClient, url: str, json_body: dict) -> httpx.Response:
    last_exc: Optional[Exception] = None
    for attempt in range(_CONNECT_RETRY_ATTEMPTS):
        try:
            return await client.post(url, json=json_body)
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            last_exc = exc
            if attempt < _CONNECT_RETRY_ATTEMPTS - 1:
                logger.warning(
                    "Ollama connect failed (attempt %d/%d), retrying in %.0fs: %s",
                    attempt + 1, _CONNECT_RETRY_ATTEMPTS, _CONNECT_RETRY_DELAY_SECONDS, exc,
                )
                await asyncio.sleep(_CONNECT_RETRY_DELAY_SECONDS)
    assert last_exc is not None
    raise last_exc


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vector))
    if norm == 0:
        return vector
    return [v / norm for v in vector]


async def embed_text(text: str) -> list[float]:
    """Returns an L2-normalized embedding vector for the given text."""
    settings = get_settings()
    timeout = httpx.Timeout(connect=_CONNECT_TIMEOUT, read=_EMBED_READ_TIMEOUT, write=10.0, pool=5.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await _post_with_retry(
            client, f"{settings.OLLAMA_URL}/api/embeddings",
            {"model": settings.OLLAMA_EMBED_MODEL, "prompt": text},
        )
        resp.raise_for_status()
        data = resp.json()
    return _normalize(data["embedding"])


async def chat_completion(
    question: str,
    context_blurbs: list[str],
    system_prompt: Optional[str] = None,
    max_tokens: Optional[int] = None,
) -> str:
    """Grounded chat completion: the model is instructed to answer only
    from the given context, and to say so plainly when the context
    doesn't contain the answer, rather than guessing about infrastructure
    it has no real data for.

    `max_tokens` overrides _MAX_RESPONSE_TOKENS — used by the router with
    a small value when it's about to append a real, deterministically
    computed list (e.g. free IP addresses) after the model's reply:
    letting the model regenerate a 15-address list itself risks it
    garbling a real address — a correctness problem, not a speed one, so
    faster hardware doesn't change this — far better to have it write
    one short intro sentence and append the actual correct list in code
    (see assistant.py's _free_address_info)."""
    settings = get_settings()
    default_system = (
        "You are an assistant for the IOP IPAM portal. Answer the "
        "question using ONLY the context records below. If the context "
        "doesn't contain enough information to answer, say so explicitly "
        "instead of guessing. Be concise — 2-4 sentences."
    )
    context_text = "\n".join(f"- {b}" for b in context_blurbs) or "(no matching records found)"
    prompt = f"Context records:\n{context_text}\n\nQuestion: {question}"

    timeout = httpx.Timeout(connect=_CONNECT_TIMEOUT, read=_CHAT_READ_TIMEOUT, write=10.0, pool=5.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await _post_with_retry(
            client, f"{settings.OLLAMA_URL}/api/chat",
            {
                "model": settings.OLLAMA_CHAT_MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt or default_system},
                    {"role": "user", "content": prompt},
                ],
                "stream": False,
                "options": {"num_predict": max_tokens or _MAX_RESPONSE_TOKENS},
            },
        )
        resp.raise_for_status()
        data = resp.json()
    return data["message"]["content"].strip()
