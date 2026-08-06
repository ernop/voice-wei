#!/usr/bin/env python3
"""Theme combiner for the word-coolness scorer.

Pick two different themes (config "themes" in coolness-config.json); the
combiner randomly pairs words across them as spaced phrases ("vibe
kernel") and fused blends ("grove" + "code" -> "grode"), scores every
candidate through the coolness engine, and prints the batch ranked by
score. Adjust between batches: switch formula, tweak individual weights,
change themes, mode, or batch size.

Every generated batch is appended to the append-only session log
coolness-log.jsonl (one JSON object per line, never rewritten), so no
output is ever lost.

Usage:
  python3 coolness-combine.py                          interactive session
  python3 coolness-combine.py --themes music tech --once
  python3 coolness-combine.py --themes mood tech --formula zeitgeist \
      --mode blend --count 12 --seed 42 --once --json
  --log PATH    override the log destination (default coolness-log.jsonl)

Interactive commands:
  <enter> or more          next random batch
  themes <a> <b>           switch to two different themes
  formula <id>             switch formula (list with: formulas)
  weight <metric> <value>  adjust one weight (formula becomes "custom")
  mode phrase|blend|both   what to generate
  count <n>                batch size
  list                     show themes    formulas   show formulas
  quit                     exit
"""

import argparse
import json
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

import coolness

LOG_PATH = coolness.ROOT / "coolness-log.jsonl"
VOWEL_LETTERS = set("aeiou")


def first_vowel_run(letters):
    """(start, end) of the first vowel-letter run, or None."""
    start = None
    for i, ch in enumerate(letters):
        if ch in VOWEL_LETTERS:
            if start is None:
                start = i
        elif start is not None:
            return (start, i)
    return None if start is None else (start, len(letters))


def blend_words(a, b):
    """Classic blend: A's onset + B from its first vowel run (br+unch).
    Vowel-initial A contributes through the end of its first vowel run."""
    run_a = first_vowel_run(a)
    run_b = first_vowel_run(b)
    if run_a is None or run_b is None:
        return None
    prefix = a[:run_a[0]] if run_a[0] > 0 else a[:run_a[1]]
    blended = prefix + b[run_b[0]:]
    if len(blended) < 3 or blended in (a, b):
        return None
    return blended


class Session:
    def __init__(self, config, scorer, log_path):
        self.config = config
        self.scorer = scorer
        self.log_path = Path(log_path)
        self.themes = config["themes"]
        self.theme_a = None
        self.theme_b = None
        self.formula_id = "balanced"
        self.weights = dict(coolness.find_formula(config, "balanced")["weights"])
        self.mode = "both"
        self.count = 15

    def set_themes(self, a, b):
        if a == b:
            raise SystemExit("pick two DIFFERENT themes")
        for name in (a, b):
            if name not in self.themes:
                known = ", ".join(sorted(self.themes))
                raise SystemExit(f"unknown theme '{name}' (known: {known})")
        self.theme_a = a
        self.theme_b = b

    def set_formula(self, formula_id):
        formula = coolness.find_formula(self.config, formula_id)
        self.formula_id = formula_id
        self.weights = dict(formula["weights"])

    def set_weight(self, metric, value):
        if metric not in self.weights:
            raise SystemExit(f"unknown metric '{metric}' "
                             f"(known: {', '.join(self.weights)})")
        self.weights[metric] = value
        self.formula_id = "custom"

    # ---- generation --------------------------------------------------

    def candidate(self, rng):
        word_a = rng.choice(self.themes[self.theme_a])
        word_b = rng.choice(self.themes[self.theme_b])
        form = self.mode if self.mode != "both" else rng.choice(["phrase", "blend"])
        if form == "phrase":
            score_a = self.scorer.score(word_a, self.weights)["total"]
            score_b = self.scorer.score(word_b, self.weights)["total"]
            return {
                "text": f"{word_a} {word_b}",
                "form": "phrase",
                "source": f"{word_a} + {word_b}",
                "score": coolness.round_places((score_a + score_b) / 2, 1),
            }
        blended = blend_words(word_a, word_b)
        if blended is None:
            return None
        return {
            "text": blended,
            "form": "blend",
            "source": f"{word_a} + {word_b}",
            "score": self.scorer.score(blended, self.weights)["total"],
        }

    def batch(self, rng):
        results = []
        seen = set()
        attempts = 0
        while len(results) < self.count and attempts < self.count * 30:
            attempts += 1
            row = self.candidate(rng)
            if row is None or row["text"] in seen:
                continue
            seen.add(row["text"])
            results.append(row)
        results.sort(key=lambda row: (-row["score"], row["text"]))
        return results

    # ---- output ---------------------------------------------------------

    def print_batch(self, results):
        print(f"\n{self.theme_a} x {self.theme_b}  |  formula {self.formula_id}"
              f"  |  mode {self.mode}  |  {len(results)} candidates")
        for rank, row in enumerate(results, start=1):
            bar = "#" * int(round(row["score"] / 5))
            detail = f"({row['source']}, blend)" if row["form"] == "blend" \
                else f"({row['source']})"
            print(f"{rank:3d}  {row['score']:5.1f}  {row['text']:22s} "
                  f"{detail:28s} {bar}")

    def log_batch(self, results):
        entry = {
            "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "kind": "combine-batch",
            "themes": [self.theme_a, self.theme_b],
            "formula": self.formula_id,
            "weights": self.weights,
            "mode": self.mode,
            "results": results,
        }
        # Append-only by contract: never opened for writing/truncation.
        with open(self.log_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")

    def run_batch(self, rng):
        results = self.batch(rng)
        self.print_batch(results)
        self.log_batch(results)
        return results


def prompt_themes(session):
    names = sorted(session.themes)
    print("Themes:")
    for i, name in enumerate(names, start=1):
        preview = ", ".join(session.themes[name][:5])
        print(f"  {i:2d}. {name:8s} {preview}, ...")
    while True:
        raw = input("Pick two different themes (e.g. 'music tech' or '1 3'): ").strip()
        parts = raw.split()
        if len(parts) != 2:
            print("Need exactly two theme names or numbers.")
            continue
        picked = []
        for part in parts:
            if part.isdigit() and 1 <= int(part) <= len(names):
                picked.append(names[int(part) - 1])
            else:
                picked.append(part)
        try:
            session.set_themes(picked[0], picked[1])
            return
        except SystemExit as err:
            print(err)


def interactive(session, rng):
    print(__doc__.split("Usage:")[0].strip())
    print()
    prompt_themes(session)
    session.run_batch(rng)
    while True:
        try:
            raw = input("\n[enter=more] > ").strip()
        except EOFError:
            print()
            return
        parts = raw.split()
        command = parts[0] if parts else "more"
        try:
            if command in ("more", ""):
                session.run_batch(rng)
            elif command == "themes" and len(parts) == 3:
                session.set_themes(parts[1], parts[2])
                session.run_batch(rng)
            elif command == "formula" and len(parts) == 2:
                session.set_formula(parts[1])
                session.run_batch(rng)
            elif command == "weight" and len(parts) == 3:
                session.set_weight(parts[1], float(parts[2]))
                session.run_batch(rng)
            elif command == "mode" and len(parts) == 2 \
                    and parts[1] in ("phrase", "blend", "both"):
                session.mode = parts[1]
                session.run_batch(rng)
            elif command == "count" and len(parts) == 2:
                session.count = max(1, int(parts[1]))
                session.run_batch(rng)
            elif command == "list":
                for name in sorted(session.themes):
                    print(f"  {name}: {', '.join(session.themes[name])}")
            elif command == "formulas":
                coolness.print_formulas(session.config)
            elif command in ("quit", "exit", "q"):
                return
            else:
                print("Commands: more | themes A B | formula ID | "
                      "weight METRIC VALUE | mode phrase|blend|both | "
                      "count N | list | formulas | quit")
        except SystemExit as err:
            print(err)


def main():
    parser = argparse.ArgumentParser(
        description="Theme combiner for the word-coolness scorer.")
    parser.add_argument("--themes", nargs=2, metavar=("A", "B"),
                        help="two different theme names")
    parser.add_argument("--formula", default="balanced")
    parser.add_argument("--mode", choices=["phrase", "blend", "both"],
                        default="both")
    parser.add_argument("--count", type=int, default=15)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--once", action="store_true",
                        help="print one batch and exit (no interactive loop)")
    parser.add_argument("--json", action="store_true",
                        help="with --once: emit the batch as JSON")
    parser.add_argument("--log", default=str(LOG_PATH),
                        help="append-only log path (default coolness-log.jsonl)")
    args = parser.parse_args()

    config = coolness.load_config()
    scorer = coolness.Scorer(config)
    session = Session(config, scorer, args.log)
    session.set_formula(args.formula)
    session.mode = args.mode
    session.count = args.count
    rng = random.Random(args.seed)

    if args.themes:
        session.set_themes(args.themes[0], args.themes[1])

    if args.once:
        if not args.themes:
            raise SystemExit("--once requires --themes A B")
        results = session.batch(rng)
        session.log_batch(results)
        if args.json:
            print(json.dumps(results, indent=2))
        else:
            session.print_batch(results)
        return 0

    interactive(session, rng)
    return 0


if __name__ == "__main__":
    sys.exit(main())
