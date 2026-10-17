from pathlib import Path
import re, json, gzip, sys

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "Downloads")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else Path.cwd() / "public" / "ai-dictionaries")
OUT.mkdir(parents=True, exist_ok=True)

FILES = {
    "lao2eng": ROOT / "พจนานุกรมลาวอังกฤษ" / "lao2eng.md",
    "eng2lao": ROOT / "พจนานุกรมลาวอังกฤษ" / "eng2lao.md",
    "thai2eng": ROOT / "ไทยอังกฤษ" / "thai2eng.md",
    "eng2thai": ROOT / "ไทยอังกฤษ" / "eng2thai.md",
}

for name, src in FILES.items():
    text = src.read_text(encoding="utf-8")
    matches = list(re.finditer(r"^###\s+(.+?)\s*$", text, re.M))
    data = {}
    for i, m in enumerate(matches):
        key = m.group(1).strip()
        if not key or key.startswith("#"):
            continue
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = re.sub(r"\s+", " ", text[m.end():end].strip())
        if body:
            data.setdefault(key, body[:500])
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(OUT / f"{name}.json.gz", "wb", compresslevel=9) as f:
        f.write(payload)
    print(name, len(data), len(payload))
