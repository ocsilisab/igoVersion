from pathlib import Path

from src.dataset import iter_sgf_bytes_recursive


def test_iter_sgf_bytes_recursive_finds_nested_files(tmp_path: Path):
    (tmp_path / "2019" / "05" / "01").mkdir(parents=True)
    (tmp_path / "2019" / "05" / "02").mkdir(parents=True)
    file_a = tmp_path / "2019" / "05" / "01" / "1-alice-bob.sgf"
    file_b = tmp_path / "2019" / "05" / "02" / "2-carol-dave.sgf"
    file_a.write_bytes(b"(;GM[1]FF[4]SZ[9];B[ee])")
    file_b.write_bytes(b"(;GM[1]FF[4]SZ[13];B[gg])")
    (tmp_path / "2019" / "05" / "01" / "notes.txt").write_bytes(b"not an sgf")

    results = list(iter_sgf_bytes_recursive(tmp_path))
    assert len(results) == 2
    assert set(results) == {file_a.read_bytes(), file_b.read_bytes()}


def test_iter_sgf_bytes_recursive_empty_dir_yields_nothing(tmp_path: Path):
    assert list(iter_sgf_bytes_recursive(tmp_path)) == []
