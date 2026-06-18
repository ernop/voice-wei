#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${VOICE_WEI_SONG_SOURCES_DIR:-"${ROOT_DIR}/.dev/song-sources"}"
INCLUDE_PDMX=0

for arg in "$@"; do
    case "$arg" in
        --include-pdmx)
            INCLUDE_PDMX=1
            ;;
        --help|-h)
            cat <<'HELP'
Download public-domain symbolic song sources for Voice-Wei.

Defaults:
  - OpenScore Lieder release snapshot from Zenodo
  - Mutopia Project source/MIDI archive from GitHub

Optional:
  --include-pdmx    Also download PDMX from Zenodo. This is very large.

Environment:
  VOICE_WEI_SONG_SOURCES_DIR=/path/to/destination
HELP
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            exit 1
            ;;
    esac
done

if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required for Zenodo downloads" >&2
    exit 1
fi

mkdir -p "$DEST_DIR"

download_zenodo_record() {
    local record_id="$1"
    local target_dir="$2"
    shift 2

    python3 - "$record_id" "$target_dir" "$@" <<'PY'
import json
import sys
import urllib.request
from pathlib import Path
from zipfile import ZipFile

record_id = sys.argv[1]
target_dir = Path(sys.argv[2])
wanted = set(sys.argv[3:])
target_dir.mkdir(parents=True, exist_ok=True)

with urllib.request.urlopen(f"https://zenodo.org/api/records/{record_id}") as response:
    record = json.load(response)

for item in record["files"]:
    key = item["key"]
    if wanted and key not in wanted:
        continue

    url = item["links"]["self"]
    output = target_dir / key.replace("/", "__")
    if output.exists() and output.stat().st_size == item["size"]:
        print(f"Already downloaded {output}")
    else:
        print(f"Downloading {key} -> {output}")
        with urllib.request.urlopen(url) as response, output.open("wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)

    if output.suffix.lower() == ".zip":
        extract_dir = target_dir / output.stem
        marker = extract_dir / ".extracted"
        if marker.exists():
            print(f"Already extracted {extract_dir}")
        else:
            print(f"Extracting {output} -> {extract_dir}")
            extract_dir.mkdir(parents=True, exist_ok=True)
            with ZipFile(output) as archive:
                archive.extractall(extract_dir)
            marker.write_text("ok\n")
PY
}

clone_or_update_repo() {
    local url="$1"
    local branch="$2"
    local target="$3"

    if [[ -d "$target/.git" ]]; then
        echo "Updating $(basename "$target")"
        git -C "$target" pull --ff-only
    else
        echo "Cloning $url -> $target"
        git clone --depth 1 --branch "$branch" "$url" "$target"
    fi
}

download_mutopia_midi_from_site() {
    local mutopia_repo="$DEST_DIR/mutopia"
    local midi_dir="$DEST_DIR/mutopia-midi"

    if [[ ! -d "$mutopia_repo/ftp" ]]; then
        echo "Mutopia source repo not found; skipping website MIDI mirror."
        return
    fi

    python3 - "$mutopia_repo/ftp" "$midi_dir" <<'PY'
import concurrent.futures
import sys
import urllib.error
import urllib.request
from pathlib import Path

source_root = Path(sys.argv[1])
target_root = Path(sys.argv[2])
base_url = "https://www.mutopiaproject.org/ftp"
ly_files = sorted(source_root.glob("**/*.ly"))

def download(path):
    rel = path.relative_to(source_root).with_suffix(".mid")
    output = target_root / rel
    if output.exists() and output.stat().st_size > 0:
        return "cached"

    url = f"{base_url}/{rel.as_posix()}"
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            if response.status != 200:
                return "missing"
            payload = response.read()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return "missing"
        return "error"
    except Exception:
        return "error"

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(payload)
    return "downloaded"

counts = {"cached": 0, "downloaded": 0, "missing": 0, "error": 0}
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
    for result in executor.map(download, ly_files):
        counts[result] += 1

print(
    "Mutopia MIDI mirror: "
    f"{counts['downloaded']} downloaded, "
    f"{counts['cached']} cached, "
    f"{counts['missing']} missing, "
    f"{counts['error']} errors"
)
PY
}

convert_lieder_if_possible() {
    local conversion_file
    conversion_file="$(python3 - "$DEST_DIR/openscore-lieder" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
matches = sorted(root.glob("**/corpus_conversion.json"))
print(matches[0] if matches else "")
PY
)"
    local converter=""

    for candidate in mscore musescore musescore3 musescore4; do
        if command -v "$candidate" >/dev/null 2>&1; then
            converter="$candidate"
            break
        fi
    done

    if [[ -z "$converter" || -z "$conversion_file" || ! -f "$conversion_file" ]]; then
        echo "OpenScore Lieder downloaded. Install MuseScore CLI to batch-convert it to MIDI/MusicXML."
        return
    fi

    python3 - "$conversion_file" <<'PY'
import json
import sys
from pathlib import Path

source = Path(sys.argv[1])
data = json.loads(source.read_text())

for extension in ("mid", "musicxml"):
    converted = []
    for item in data:
        next_item = dict(item)
        output = Path(next_item["out"])
        next_item["out"] = str(output.with_suffix(f".{extension}"))
        converted.append(next_item)
    source.with_name(f"corpus_conversion_{extension}.json").write_text(json.dumps(converted, indent=2) + "\n")
PY

    echo "Converting OpenScore Lieder with $converter"
    (cd "$(dirname "$conversion_file")" && "$converter" -j corpus_conversion_mid.json && "$converter" -j corpus_conversion_musicxml.json)
}

cat > "$DEST_DIR/SOURCES.md" <<'EOF'
# Public-Domain Symbolic Song Sources

Downloaded here by `download-public-domain-songs.sh`.

- OpenScore Lieder: vocal songs, CC0/public-domain corpus. Source: https://github.com/OpenScore/Lieder and Zenodo record https://zenodo.org/records/15450144
- Mutopia Project: public-domain/open sheet music in LilyPond with MIDI outputs where available. Source: https://github.com/MutopiaProject/MutopiaProject
- PDMX: very large MusicXML/MIDI/PDF dataset from MuseScore public-domain/CC0 metadata. Source: https://zenodo.org/records/14648209

PDMX is intentionally opt-in because the Zenodo archive is large and the dataset authors describe metadata reliability caveats.
EOF

download_zenodo_record "15450144" "$DEST_DIR/openscore-lieder"
convert_lieder_if_possible

clone_or_update_repo "https://github.com/MutopiaProject/MutopiaProject.git" "master" "$DEST_DIR/mutopia"
download_mutopia_midi_from_site

if [[ "$INCLUDE_PDMX" -eq 1 ]]; then
    download_zenodo_record "14648209" "$DEST_DIR/pdmx"
else
    echo "Skipping PDMX. Re-run with --include-pdmx if you want the large Zenodo dataset."
fi

cat <<EOF

Done.

Local source root:
  $DEST_DIR

Importable files to try first:
  $DEST_DIR/mutopia-midi/**/*.mid
  $DEST_DIR/openscore-lieder/**/**/*.mid
  $DEST_DIR/openscore-lieder/**/**/*.musicxml
EOF
