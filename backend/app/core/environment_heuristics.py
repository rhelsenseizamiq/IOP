"""Shared heuristics for guessing an IP record's Environment from a
hostname string, used by every nightly sync script (Device42, Zabbix,
PaloAlto, vCenter). A single shared source avoids the four scripts
silently drifting out of sync with each other over time.
"""

# Words that contain "test" as a substring but have nothing to do with a
# Test environment — a plain `"test" in name.lower()` check would
# false-positive on a hostname like "attestation-svc" or "latest-backup".
# Verified against real production hostnames: excluding these changes
# ZERO currently-correct classifications (every hostname matching "test"
# today is genuinely test-related, e.g. Testinium-branded automation
# nodes) — this list only closes off a future false-positive risk.
_TEST_FALSE_POSITIVE_WORDS = (
    "attestation",
    "attest",
    "contest",
    "protest",
    "detest",
    "latest",
    "greatest",
    "fastest",
    "testament",
)


def looks_like_test(name: str | None) -> bool:
    """True if `name` genuinely looks test-related. Strips known
    false-positive words first, then checks whatever "test" remains —
    deliberately NOT a whole-word check, since real test hostnames here
    often glue "test" onto other letters with no separator (e.g.
    "TestiniumNode12"), which a whole-word regex would incorrectly reject."""
    if not name:
        return False
    lc = name.lower()
    if "test" not in lc:
        return False
    scrubbed = lc
    for word in _TEST_FALSE_POSITIVE_WORDS:
        scrubbed = scrubbed.replace(word, "")
    return "test" in scrubbed
