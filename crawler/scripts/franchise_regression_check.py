from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from franchise_checker import is_franchise

CASES: list[tuple[str, bool]] = [
    ("스타벅스 강남역점", True),
    ("스타벅스강남역점", True),
    ("이디야커피 홍대점", True),
    ("메가MGC커피선릉점", True),
    ("완전개인카페", False),
]


def main() -> None:
    failed = []
    for name, expected in CASES:
        actual = is_franchise(name)
        print(f"{name}: expected={expected}, actual={actual}")
        if actual != expected:
            failed.append((name, expected, actual))

    if failed:
        details = ", ".join(
            f"{name}(expected={expected}, actual={actual})"
            for name, expected, actual in failed
        )
        raise SystemExit(f"Regression check failed: {details}")

    print("All franchise regression checks passed")


if __name__ == "__main__":
    main()
