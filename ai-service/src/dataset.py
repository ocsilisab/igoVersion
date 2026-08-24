"""Downloads and caches SGF archives from featurecat/go-dataset (Fox Go server games,
grouped by rank), and iterates the raw SGF files inside them.

Caching: both the downloaded .7z and its extracted contents are kept in `data/raw/`
and skipped on subsequent runs (see ensure_rank_extracted). Re-running preprocessing
never re-downloads or re-extracts a rank that's already there.

v1 only fetches the primary "<rank>.7z" archive per rank (not the secondary
"<rank>2.7z.001" bonus batch some ranks have) -- 7d/8d/9d's primary archives alone
already hold ~100k-240k games each, far more than config.yaml's max_games needs.
"""

import urllib.request
from pathlib import Path
from typing import Iterator

import py7zr

ARCHIVE_URL_TEMPLATE = "https://raw.githubusercontent.com/featurecat/go-dataset/master/{rank}/{rank}.7z"


def download_rank_archive(rank: str, raw_dir: Path) -> Path:
    raw_dir.mkdir(parents=True, exist_ok=True)
    archive_path = raw_dir / f"{rank}.7z"
    if archive_path.exists():
        return archive_path

    url = ARCHIVE_URL_TEMPLATE.format(rank=rank)
    tmp_path = archive_path.with_suffix(".7z.part")
    urllib.request.urlretrieve(url, tmp_path)  # noqa: S310 -- fixed, hardcoded GitHub raw URL
    tmp_path.rename(archive_path)
    return archive_path


def ensure_rank_extracted(rank: str, data_dir: Path) -> Path:
    """Downloads (if needed) and extracts (if needed) a rank's archive. Returns the
    directory containing its .sgf files."""
    raw_dir = data_dir / "raw"
    extract_dir = raw_dir / rank
    done_marker = extract_dir / ".extracted"
    if done_marker.exists():
        return extract_dir

    archive_path = download_rank_archive(rank, raw_dir)
    extract_dir.mkdir(parents=True, exist_ok=True)
    with py7zr.SevenZipFile(archive_path, mode="r") as archive:
        archive.extractall(path=extract_dir)
    done_marker.touch()
    return extract_dir


def iter_rank_sgf_bytes(rank: str, data_dir: Path) -> Iterator[bytes]:
    """Streams raw SGF file contents for a rank, one file at a time (never holds more
    than one game's bytes in memory)."""
    extract_dir = ensure_rank_extracted(rank, data_dir)
    for sgf_path in sorted(extract_dir.rglob("*.sgf")):
        yield sgf_path.read_bytes()


def iter_sgf_bytes_recursive(root_dir: Path) -> Iterator[bytes]:
    """Streams raw SGF file contents from every *.sgf file found recursively under
    `root_dir`, in whatever order the filesystem returns them (deliberately *not*
    sorted). For a pre-downloaded, pre-extracted archive that isn't organized into
    per-rank folders the way iter_rank_sgf_bytes expects — e.g. the OGS dump, laid out as
    sgfs-by-date/<year>/<month>/<day>/*.sgf, tens of millions of files deep — rather than
    a second "how to fetch it" mechanism, since that download is a one-off (see
    preprocess_ogs.py) and 6+ GB isn't something to script an automatic re-download of.

    Unlike iter_rank_sgf_bytes's per-rank folders (a few hundred thousand files, small
    enough that sorting them upfront is instant), sorting a source this size before
    yielding a single file means fully materializing tens of millions of Path objects
    into memory first — multiple GB and minutes with zero progress to show for it, purely
    to get a determinism guarantee this caller doesn't actually need (max_games and the
    per-game rank filter already make "the exact file order" irrelevant to the result)."""
    for sgf_path in root_dir.rglob("*.sgf"):
        yield sgf_path.read_bytes()
