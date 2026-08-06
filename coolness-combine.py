#!/usr/bin/env python3
"""Word combiner for the word-coolness scorer. NEW words only,
compound-first.

Each A x B pair is joined three ways, straight joins before trims:
compound "glow"+"code" -> "glowcode"; seam (one letter absorbed at the
joint) "vibe"+"code" -> "vibcode", "stack"+"kernel" -> "stackernel";
clip (A cut to its first syllable, then compounded) "drift"+"code" ->
"dricode". Input sets also grow by inflected forms (config
"inflections", default -ing: run also tries running, so vibe+coding ->
"vibecoding"). Any result found in coolness-wordlist.json (30k
frequency-ranked English words plus the config vocabulary) or in the
input sets is dropped before rating. Phrases of existing words are
never generated.

Two ways to feed it:

1. Themes from the config (coolness-config.json "themes"): random batches.
2. Your own two word sets (--words-a / --words-b): the EXHAUSTIVE cross
   product, ranked, top slice printed (--top; everything is logged).

Either kind of set can be expanded with --expand N: up to N related words
are added per set via the keyless Datamuse API (api.datamuse.com), which
blends embeddings, thesaurus relations, and corpus co-occurrence. With
two expanded sets the cross product runs to thousands of candidates.

Scoring runs under any formula from the config (--formula, list with
`python3 coolness.py --formulas`); persona formulas (poet, genalpha,
boomer, streetwise) judge with their own anchor vocabularies.

Every batch is appended to the append-only session log
coolness-log.jsonl (one JSON object per line, never rewritten), so no
output is ever lost.

Usage:
  python3 coolness-combine.py                          interactive themes session
  python3 coolness-combine.py --themes music tech --once
  python3 coolness-combine.py --words-a "glow,neon,pulse" \
      --words-b "code,pixel,byte" --expand 25 --formula genalpha --top 40
  ... --seed 42 --once --json      deterministic one-shot, JSON out
  --log PATH    override the log destination (default coolness-log.jsonl)

Interactive commands (after any batch):
  <enter> or more          themes: next random batch; word sets: re-rank
  themes <a> <b>           switch to two different config themes
  formula <id>             switch scoring system (list with: formulas)
  weight <metric> <value>  adjust one weight (formula becomes "custom")
  count <n>                random batch size     top <n>   display slice
  list                     show themes           formulas  show formulas
  quit                     exit
"""

import argparse
import json
import random
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import coolness

LOG_PATH = coolness.ROOT / "coolness-log.jsonl"
WORDLIST_PATH = coolness.ROOT / "coolness-wordlist.json"
DATAMUSE_URL = "https://api.datamuse.com/words"
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


def combine_parts(a, b):
    """All combination strategies for a pair, compound-first, in
    deterministic order:
    compound  glow|code    -> glowcode      (straight join)
    seam      vibe|code    -> vibcode       (one letter absorbed at the
              stack|kernel -> stackernel     joint: silent e or a doubled
                                             seam letter)
    clip      drift|code   -> dricode       (A cut to its first syllable,
                                             then compounded)
    Returns [(strategy, text), ...]; callers filter real words."""
    parts = [("compound", a + b)]
    if a[-1] == b[0]:
        parts.append(("seam", a + b[1:]))
    elif a[-1] == "e":
        parts.append(("seam", a[:-1] + b))
    run_a = first_vowel_run(a)
    if run_a is not None and run_a[1] < len(a):
        parts.append(("clip", a[:run_a[1]] + b))
    return parts


def inflect(word, suffix):
    """Rough English suffixing: code+ing -> coding (silent-e drop),
    run+ing -> running (short-word final-consonant doubling),
    glow+ing -> glowing. Same rules in the browser mirror."""
    if len(word) < 2:
        return word + suffix
    base = word
    if word[-1] == "e" and word[-2] not in VOWEL_LETTERS:
        base = word[:-1]
    elif (len(word) <= 4
          and word[-1] not in VOWEL_LETTERS and word[-1] not in "wxy"
          and word[-2] in VOWEL_LETTERS
          and word[-3] not in VOWEL_LETTERS):
        base = word + word[-1]
    return base + suffix


def load_real_words():
    data = json.loads(WORDLIST_PATH.read_text(encoding="utf-8"))
    return set(data["words"])


def clean_word_list(raw):
    """Comma/space separated string -> deduped list of clean words."""
    words = []
    for part in raw.replace(",", " ").split():
        cleaned = "".join(ch for ch in part.lower() if "a" <= ch <= "z")
        if cleaned and cleaned not in words:
            words.append(cleaned)
    return words


def datamuse_related(word, limit):
    query = urllib.parse.urlencode({"ml": word, "max": limit})
    request = urllib.request.Request(
        f"{DATAMUSE_URL}?{query}", headers={"User-Agent": "voice-wei coolness"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            rows = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError) as err:
        raise SystemExit(
            f"Datamuse expansion failed for '{word}': {err} "
            "(use --expand 0 to score the sets as given)")
    related = []
    for row in rows:
        candidate = row.get("word", "")
        if len(candidate) >= 3 and candidate.isalpha() and candidate.islower():
            related.append(candidate)
    return related


def expand_set(words, n):
    """Add up to n related words, merged round-robin across the seeds so
    every seed contributes its strongest neighbors first."""
    if n <= 0:
        return []
    per_seed = [datamuse_related(word, max(10, n)) for word in words]
    added = []
    have = set(words)
    rank = 0
    while len(added) < n and any(rank < len(seed) for seed in per_seed):
        for seed in per_seed:
            if rank < len(seed):
                candidate = seed[rank]
                if candidate not in have:
                    have.add(candidate)
                    added.append(candidate)
                    if len(added) >= n:
                        break
        rank += 1
    return added


class Session:
    def __init__(self, config, scorer, log_path):
        self.config = config
        self.scorer = scorer
        self.log_path = Path(log_path)
        self.themes = config["themes"]
        self.real_words = load_real_words()
        self.set_a = None   # {label, seeds, expanded, words}
        self.set_b = None
        self.exhaustive = False
        self.formula_id = "balanced"
        self.weights = dict(coolness.find_formula(config, "balanced")["weights"])
        self.anchor_context = None
        self.count = 15
        self.top = 60
        self.dropped_real = 0

    # ---- set selection --------------------------------------------------

    def _make_set(self, label, seeds):
        """A set is its seeds plus their inflected forms (run -> running);
        Datamuse expansion is added separately by expand_sets."""
        inflected = []
        for word in seeds:
            for suffix in self.config["inflections"]:
                form = inflect(word, suffix)
                if form not in seeds and form not in inflected:
                    inflected.append(form)
        return {"label": label, "seeds": seeds, "inflected": inflected,
                "expanded": [], "words": seeds + inflected}

    def set_themes(self, a, b):
        if a == b:
            raise SystemExit("pick two DIFFERENT themes")
        for name in (a, b):
            if name not in self.themes:
                known = ", ".join(sorted(self.themes))
                raise SystemExit(f"unknown theme '{name}' (known: {known})")
        self.set_a = self._make_set(a, list(self.themes[a]))
        self.set_b = self._make_set(b, list(self.themes[b]))
        self.exhaustive = False

    def set_words(self, raw_a, raw_b):
        words_a = clean_word_list(raw_a)
        words_b = clean_word_list(raw_b)
        if not words_a or not words_b:
            raise SystemExit("both --words-a and --words-b need at least one word")
        self.set_a = self._make_set("set-a", words_a)
        self.set_b = self._make_set("set-b", words_b)
        self.exhaustive = True

    def expand_sets(self, n):
        if n <= 0:
            return
        for side in (self.set_a, self.set_b):
            side["expanded"] = expand_set(side["seeds"], n)
            side["words"] = side["seeds"] + side["inflected"] + side["expanded"]
            print(f"[{side['label']}] +{len(side['expanded'])} related: "
                  f"{', '.join(side['expanded'][:12])}"
                  f"{', ...' if len(side['expanded']) > 12 else ''}")

    # ---- scoring context -------------------------------------------------

    def set_formula(self, formula_id):
        formula = coolness.find_formula(self.config, formula_id)
        self.formula_id = formula_id
        self.weights, self.anchor_context = coolness.formula_scoring(
            self.scorer, formula)
        self.weights = dict(self.weights)

    def set_weight(self, metric, value):
        if metric not in self.weights:
            raise SystemExit(f"unknown metric '{metric}' "
                             f"(known: {', '.join(self.weights)})")
        self.weights[metric] = value
        self.formula_id = "custom"

    def score_word(self, word):
        return self.scorer.score(word, self.weights, self.anchor_context)

    # ---- generation --------------------------------------------------------
    # NEW words only: a blend is kept when it exists nowhere - not in the
    # real-English wordlist, not in either input set.

    def _is_new_word(self, text, word_a, word_b):
        # Length floor of 4: shorter blends are mostly fragments, and the
        # frequency wordlist misses rare short real words (auk, vat).
        return (len(text) >= 4
                and text not in (word_a, word_b)
                and text not in self.real_words
                and text not in self.set_a["words"]
                and text not in self.set_b["words"])

    def pair_candidates(self, word_a, word_b, seen):
        rows = []
        for strategy, text in combine_parts(word_a, word_b):
            if text in seen:
                continue
            if not self._is_new_word(text, word_a, word_b):
                self.dropped_real += text in self.real_words
                continue
            seen.add(text)
            rows.append({
                "text": text,
                "strategy": strategy,
                "source": f"{word_a} + {word_b}",
                "score": self.score_word(text)["total"],
            })
        return rows

    def exhaustive_batch(self):
        results = []
        seen = set()
        self.dropped_real = 0
        for word_a in self.set_a["words"]:
            for word_b in self.set_b["words"]:
                results.extend(self.pair_candidates(word_a, word_b, seen))
        results.sort(key=lambda row: (-row["score"], row["text"]))
        return results

    def random_batch(self, rng):
        results = []
        seen = set()
        self.dropped_real = 0
        attempts = 0
        while len(results) < self.count and attempts < self.count * 30:
            attempts += 1
            word_a = rng.choice(self.set_a["words"])
            word_b = rng.choice(self.set_b["words"])
            results.extend(self.pair_candidates(word_a, word_b, seen))
        results = results[:self.count]
        results.sort(key=lambda row: (-row["score"], row["text"]))
        return results

    # ---- output ---------------------------------------------------------------

    def print_batch(self, results):
        shown = results if self.top <= 0 else results[:self.top]
        print(f"\n{self.set_a['label']} x {self.set_b['label']}"
              f"  |  formula {self.formula_id}"
              f"  |  {len(results)} new words"
              f" ({self.dropped_real} real words dropped)"
              + (f", top {len(shown)}" if len(shown) < len(results) else ""))
        for rank, row in enumerate(shown, start=1):
            bar = "#" * int(round(row["score"] / 5))
            print(f"{rank:4d}  {row['score']:5.1f}  {row['text']:22s} "
                  f"({row['source']:26s}) {bar}")

    def log_batch(self, results):
        entry = {
            "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "kind": "combine-exhaustive" if self.exhaustive else "combine-batch",
            "sets": {
                "a": self.set_a,
                "b": self.set_b,
            },
            "formula": self.formula_id,
            "weights": self.weights,
            "droppedRealWords": self.dropped_real,
            "results": results,
        }
        # Append-only by contract: never opened for writing/truncation.
        with open(self.log_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")

    def run_batch(self, rng):
        results = self.exhaustive_batch() if self.exhaustive \
            else self.random_batch(rng)
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
            elif command == "count" and len(parts) == 2:
                session.count = max(1, int(parts[1]))
                session.run_batch(rng)
            elif command == "top" and len(parts) == 2:
                session.top = 0 if parts[1] == "all" else max(1, int(parts[1]))
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
                      "weight METRIC VALUE | count N | top N|all | "
                      "list | formulas | quit")
        except SystemExit as err:
            print(err)


def main():
    parser = argparse.ArgumentParser(
        description="Word combiner for the word-coolness scorer.")
    parser.add_argument("--themes", nargs=2, metavar=("A", "B"),
                        help="two different config theme names (random batches)")
    parser.add_argument("--words-a", metavar="WORDS",
                        help="your own first set, comma/space separated "
                             "(exhaustive cross product)")
    parser.add_argument("--words-b", metavar="WORDS",
                        help="your own second set")
    parser.add_argument("--expand", type=int, default=0, metavar="N",
                        help="add up to N related words per set via the "
                             "keyless Datamuse API (0 = off)")
    parser.add_argument("--formula", default="balanced")
    parser.add_argument("--count", type=int, default=15,
                        help="random batch size (theme mode)")
    parser.add_argument("--top", type=int, default=60,
                        help="how many ranked rows to print (0 = all)")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--once", action="store_true",
                        help="print one batch and exit (no interactive loop)")
    parser.add_argument("--json", action="store_true",
                        help="with --once: emit the full ranked batch as JSON")
    parser.add_argument("--log", default=str(LOG_PATH),
                        help="append-only log path (default coolness-log.jsonl)")
    args = parser.parse_args()

    if bool(args.words_a) != bool(args.words_b):
        raise SystemExit("--words-a and --words-b go together")
    if args.words_a and args.themes:
        raise SystemExit("use either --themes or --words-a/--words-b, not both")

    config = coolness.load_config()
    scorer = coolness.Scorer(config)
    session = Session(config, scorer, args.log)
    session.set_formula(args.formula)
    session.count = args.count
    session.top = max(0, args.top)
    rng = random.Random(args.seed)

    if args.words_a:
        session.set_words(args.words_a, args.words_b)
    elif args.themes:
        session.set_themes(args.themes[0], args.themes[1])

    if session.set_a:
        session.expand_sets(args.expand)

    if args.once:
        if not session.set_a:
            raise SystemExit("--once needs --themes A B or --words-a/--words-b")
        results = session.exhaustive_batch() if session.exhaustive \
            else session.random_batch(rng)
        session.log_batch(results)
        if args.json:
            print(json.dumps(results, indent=2))
        else:
            session.print_batch(results)
        return 0

    print(__doc__.split("Usage:")[0].strip())
    print()
    if not session.set_a:
        prompt_themes(session)
        session.expand_sets(args.expand)
    session.run_batch(rng)
    interactive(session, rng)
    return 0


if __name__ == "__main__":
    sys.exit(main())
