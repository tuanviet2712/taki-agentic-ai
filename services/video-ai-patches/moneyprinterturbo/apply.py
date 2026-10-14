"""TAKI patch for MoneyPrinterTurbo: stop Edge TTS failing on long narration.

Why: the free Edge TTS endpoint hangs / answers "No audio was received" when one request carries a long script
(~150+ words); MoneyPrinterTurbo then fails with "edge_tts stream timed out after 30s ... failed to synthesize audio".
Fix: split long narration at sentence boundaries into chunks of <= 220 chars and reuse MoneyPrinterTurbo's own
segment pipeline (`_tts_with_pauses`), which decodes every chunk, concatenates the PCM exactly and shifts the subtitle
cues by the real sample count. Also raises `edge_tts_timeout` 30 -> 60 s in config.toml.

Idempotent. Usage: python apply.py <MoneyPrinterTurbo dir>"""
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
voice = root / "app/services/voice.py"
text = voice.read_text(encoding="utf-8")  # explicit: Windows defaults to cp1252
MARK = "# --- TAKI patch: split long narration for Edge TTS ---"

HELPERS = f'''{MARK}
EDGE_TTS_MAX_CHUNK_CHARS = 220


def _split_long_speech(text: str, limit: int = EDGE_TTS_MAX_CHUNK_CHARS) -> list[str]:
    """Cut narration into chunks of at most `limit` chars, at sentence ends first, then commas, then spaces."""
    text = (text or "").strip()
    if len(text) <= limit:
        return [text] if text else []
    pieces: list[str] = []
    for sentence in re.split(r"(?<=[.!?…])\\s+|\\n+", text):
        sentence = sentence.strip()
        while len(sentence) > limit:
            cut = max(sentence.rfind(sep, 0, limit) for sep in (",", ";", ":"))
            if cut <= 0:
                cut = sentence.rfind(" ", 0, limit)
            if cut <= 0:
                cut = limit - 1
            pieces.append(sentence[: cut + 1].strip())
            sentence = sentence[cut + 1 :].strip()
        if sentence:
            pieces.append(sentence)
    chunks: list[str] = []
    current = ""
    for piece in pieces:
        if current and len(current) + 1 + len(piece) > limit:
            chunks.append(current)
            current = piece
        else:
            current = f"{{current}} {{piece}}".strip()
    if current:
        chunks.append(current)
    return chunks


def _expand_long_speech(segments: list) -> list:
    expanded: list = []
    for kind, value in segments:
        if kind == "speech":
            expanded.extend(("speech", part) for part in _split_long_speech(str(value)))
        else:
            expanded.append((kind, value))
    return expanded


'''

if MARK in text:
    print("voice.py already patched")
else:
    edits = [
        # 1) helpers go right before the segment pipeline
        ("def _tts_with_pauses(\n", HELPERS + "def _tts_with_pauses(\n"),
        # 2) the pipeline splits every long speech segment
        ("    segments = utils.parse_script_with_pauses(text)\n    if not segments:\n        return None\n",
         "    segments = utils.parse_script_with_pauses(text)\n    if not segments:\n        return None\n    segments = _expand_long_speech(segments)  # TAKI\n"),
        # 3) several speech segments (from splitting) must not fall back to one single request
        ("    if not pause_segments:\n        clean_text = utils.remove_pause_tags(text)",
         "    if not pause_segments and len(speech_segments) <= 1:  # TAKI\n        clean_text = utils.remove_pause_tags(text)"),
        # 4) long narration without pause tags goes through the segment pipeline (Edge TTS voices only)
        ("    if not utils.has_pause_tags(text):\n        return _single_tts(",
         "    if not utils.has_pause_tags(text):\n        if is_azure_v1_voice(voice_name) and len(_split_long_speech(text)) > 1:  # TAKI\n            return _tts_with_pauses(\n                text=text,\n                voice_name=voice_name,\n                voice_rate=voice_rate,\n                voice_file=voice_file,\n                voice_volume=voice_volume,\n            )\n        return _single_tts("),
    ]
    for old, new in edits:
        if text.count(old) != 1:
            sys.exit(f"voice.py changed upstream — review the TAKI Edge TTS patch (anchor not found once): {old[:60]!r}")
        text = text.replace(old, new)
    voice.write_text(text, encoding="utf-8", newline="\n")
    print("patched voice.py")

# Edge TTS answers "No audio was received" at random (see taki-tts in video-ai.ts); upstream retries 3x with no pause,
# so all attempts land in the same bad second. Wait a little longer each time and try five times.
text = voice.read_text(encoding="utf-8")
RETRY_OLD = (
    "    for i in range(3):\n        temp_path = None\n        try:\n"
    "            logger.info(f\"start, voice name: {voice_name}, try: {i + 1}\")"
)
RETRY_NEW = (
    "    for i in range(5):  # TAKI: 5 tries with backoff\n        if i:\n            time.sleep(2 * i)\n"
    "        temp_path = None\n        try:\n"
    "            logger.info(f\"start, voice name: {voice_name}, try: {i + 1}\")"
)
if "# TAKI: 5 tries with backoff" in text:
    print("retry already patched")
elif text.count(RETRY_OLD) == 1:
    voice.write_text(text.replace(RETRY_OLD, RETRY_NEW), encoding="utf-8", newline="\n")
    print("patched retry/backoff")
else:
    sys.exit("azure_tts_v1 retry loop changed upstream — review the TAKI Edge TTS patch")

cfg = root / "config.toml"
if cfg.exists():
    c = cfg.read_text(encoding="utf-8")
    m = re.search(r"^edge_tts_timeout\s*=\s*(\d+)\s*$", c, re.M)
    if m and int(m.group(1)) < 60:
        cfg.write_text(c[: m.start()] + "edge_tts_timeout = 60" + c[m.end() :], encoding="utf-8", newline="\n")
        print("config.toml: edge_tts_timeout = 60")
