#!/usr/bin/env python3
"""Word coolness scorer - canonical engine.

Scores how cool a word *sounds* (real or invented) from English
phonotactics plus sound symbolism. All model data lives in
coolness-config.json; this file holds only the algorithm. The browser
mirror is coolness-score.js (used by the Word lab on wording.html) and
tests/test-coolness.js keeps the two engines in exact lockstep, so any
algorithm change here must be made there too.

The seven metrics, each 0..1, combine as a weighted mean scaled to 0-100,
then multiplied by the legality gate (config legalityFloor + the rest
scaled by pronounceability), so unpronounceable strings sink:

- pronounceability: every syllable onset/coda is a legal English cluster
- flow: sonority rises into each vowel and falls after it (s+stop onsets
  and coronal coda appendices are licensed exceptions: spark, flux)
- energy: bright, punchy sounds (v, z, k, front vowels) over mushy ones
- phonesthemes: sound-symbolic prefixes/endings (gl- light, sn- nose, -ibe vibe)
- novelty: sound-pair rarity in the sweet zone between boring and unpronounceable
- anchors: n-gram similarity to the cool-word list minus the uncool-word
  list, leave-one-out (a listed word never matches itself)
- brevity: one or two syllables land hardest

A hyphen marks a compound joint: "vibe-code" reads each part with its own
spelling rules (vibe's silent e stays silent), then scores the joined word.
The combiner always scores its coinages this way.

config "sampleTiers" (cool, coined, bland, gross, junk) is the calibration
set: --report and --calibrate measure how often a formula orders words
from differently ranked tiers correctly.

Named formulas (config "formulas") are alternative weightings of the same
seven metrics, each modeled on a strand of the naming/phonology literature
(processing fluency, phonotactic probability, phonaesthetics, nonword
surprise, association). Select one with --formula.

Usage:
  python3 coolness.py vibe zorvane phlegm     pretty breakdown per word
  python3 coolness.py --json vibe zorvane     JSON to stdout
  python3 coolness.py --formula edge vibe     score under a named formula
  python3 coolness.py --formulas              list the formulas
  python3 coolness.py --report                rewrite coolness-report.json
                                              from config sampleTiers
  python3 coolness.py --calibrate             tier order per formula + bigram
                                              rarity stats (tuning aid)

The theme combiner (coolness-combine.py) builds candidate coinages from
two theme word lists and scores them through this engine.
"""

import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "coolness-config.json"
REPORT_PATH = ROOT / "coolness-report.json"

SONORITY = {
    "plosives": 1,
    "affricates": 2,
    "fricatives": 3,
    "nasals": 4,
    "liquids": 5,
    "glides": 6,
}
VOWEL_SONORITY = 7
MAX_ONSET_LEN = 3


def round_places(value, places):
    """Half-up rounding, identical to the JS mirror (Python round() is
    banker's rounding, which would break parity on exact halves)."""
    factor = 10 ** places
    return math.floor(value * factor + 0.5) / factor


class Scorer:
    def __init__(self, config):
        self.config = config
        self.digraphs = config["tokenizer"]["digraphs"]
        self.singles = config["tokenizer"]["singles"]
        self.soft_c = set(config["tokenizer"]["softCTriggers"])
        self.vowels = set(config["vowels"])
        self.legal_onsets = set(config["legalOnsets"])
        self.illegal_single_onsets = set(config["illegalSingleOnsets"])
        self.legal_codas = set(config["legalCodas"])
        self.illegal_single_codas = set(config["illegalSingleCodas"])
        self.sonority = {}
        for class_name, value in SONORITY.items():
            for token in config["sonorityClasses"][class_name]:
                self.sonority[token] = value
        for vowel in self.vowels:
            self.sonority[vowel] = VOWEL_SONORITY
        self.s_cluster_stops = set(config["sonorityExceptions"]["sClusterStops"])
        self.coda_appendix = set(config["sonorityExceptions"]["codaAppendix"])
        self.energy_values = config["energy"]["values"]
        self.energy_default = config["energy"]["default"]
        self.phonesthemes = config["phonesthemes"]
        self.novelty_cfg = config["novelty"]
        self.brevity = config["brevityBySyllables"]
        self.weights = config["weights"]
        self.default_anchor_context = self.anchor_context(config["anchors"])
        self._build_bigram_model(config["referenceLexicon"])

    def anchor_context(self, anchors):
        """Prebuilt (word, bigram set) pairs for an anchor vocabulary
        ({cool, uncool}). Formulas may carry their own anchors (persona
        vocabularies)."""
        def entries(words):
            return [(self._clean(w), self._char_bigrams(self._clean(w)))
                    for w in words]
        return (entries(anchors["cool"]), entries(anchors["uncool"]))

    # ---- tokenizer ----------------------------------------------------

    @staticmethod
    def _clean(word):
        return "".join(ch for ch in word.lower() if "a" <= ch <= "z")

    def _tokenize(self, letters):
        tokens = []

        def emit(token):
            # Doubled consonants ("bubble", "jazz") are one sound.
            if tokens and tokens[-1] == token and token not in self.vowels:
                return
            tokens.append(token)

        i = 0
        n = len(letters)
        while i < n:
            two = letters[i:i + 2]
            if two == "gh":
                # Hard g word-initially (ghost); silent elsewhere (night).
                if i == 0:
                    emit("g")
                i += 2
                continue
            if two in self.digraphs:
                for token in self.digraphs[two]:
                    emit(token)
                i += 2
                continue
            ch = letters[i]
            if ch == "c":
                soft = i + 1 < n and letters[i + 1] in self.soft_c
                emit("s" if soft else "k")
                i += 1
                continue
            if ch in self.singles:
                for token in self.singles[ch]:
                    emit(token)
                i += 1
                continue
            emit(ch)
            i += 1

        # Final silent e (vibe, blaze) - unless it makes a syllabic-l
        # syllable (table, bubble) or is the only vowel (the).
        if len(tokens) >= 2 and tokens[-1] == "e":
            flags = self._vowel_flags(tokens)
            rest = tokens[:-1]
            syllabic_l = (len(tokens) >= 3 and tokens[-2] == "l"
                          and not flags[-3])
            if not flags[-2] and any(self._vowel_flags(rest)) and not syllabic_l:
                tokens = rest
        return tokens

    def _vowel_flags(self, tokens):
        """Which tokens are vowel sounds. y after the first sound is a
        vowel (kyro); w closing a vowel before a consonant or the end is
        part of that vowel (glow, brew, glowcode), not a coda."""
        flags = []
        for i, token in enumerate(tokens):
            if token in self.vowels or (token == "y" and i > 0):
                flags.append(True)
            elif token == "w" and i > 0 and flags[i - 1]:
                flags.append(i + 1 == len(tokens) or tokens[i + 1] not in self.vowels)
            else:
                flags.append(False)
        return flags

    # ---- syllabification ----------------------------------------------

    def _syllabify(self, tokens):
        flags = self._vowel_flags(tokens)
        if not any(flags):
            return [{"onset": list(tokens), "nucleus": [], "coda": []}]

        nuclei = []
        i = 0
        while i < len(tokens):
            if flags[i]:
                start = i
                while i < len(tokens) and flags[i]:
                    i += 1
                nuclei.append((start, i - 1))
            else:
                i += 1

        syllables = []
        for k, (start, end) in enumerate(nuclei):
            syllables.append({
                "onset": tokens[:start] if k == 0 else [],
                "nucleus": tokens[start:end + 1],
                "coda": tokens[end + 1:] if k == len(nuclei) - 1 else [],
            })

        # Maximal onset: between two nuclei, the next syllable takes the
        # longest legal onset; the rest stays as the previous coda.
        for k in range(len(nuclei) - 1):
            gap = tokens[nuclei[k][1] + 1:nuclei[k + 1][0]]
            take = 0
            for j in range(min(len(gap), MAX_ONSET_LEN), 0, -1):
                if self._onset_legal(gap[len(gap) - j:]):
                    take = j
                    break
            syllables[k]["coda"] = gap[:len(gap) - take]
            syllables[k + 1]["onset"] = gap[len(gap) - take:]
        return syllables

    def _onset_legal(self, seq):
        if len(seq) == 1:
            return seq[0] not in self.illegal_single_onsets
        return "".join(seq) in self.legal_onsets

    def _coda_legal(self, seq):
        if len(seq) == 1:
            return seq[0] not in self.illegal_single_codas
        return "".join(seq) in self.legal_codas

    # ---- bigram model (novelty) ----------------------------------------

    def _build_bigram_model(self, lexicon):
        counts = {}
        seen_tokens = set()
        total = 0
        for word in lexicon:
            tokens = self._tokenize(self._clean(word))
            seen_tokens.update(tokens)
            for a, b in zip(tokens, tokens[1:]):
                counts[(a, b)] = counts.get((a, b), 0) + 1
                total += 1
        self.bigram_counts = counts
        self.bigram_total = total
        self.bigram_vocab = len(seen_tokens) ** 2

    def _rarity(self, a, b):
        count = self.bigram_counts.get((a, b), 0)
        p = (count + 0.5) / (self.bigram_total + 0.5 * self.bigram_vocab)
        return -math.log(p)

    # ---- anchor similarity ----------------------------------------------

    @staticmethod
    def _char_bigrams(letters):
        padded = "^" + letters + "$"
        return {padded[i:i + 2] for i in range(len(padded) - 1)}

    @staticmethod
    def _dice(a, b):
        if not a or not b:
            return 0.0
        return 2 * len(a & b) / (len(a) + len(b))

    # ---- metrics ---------------------------------------------------------

    def _metric_pronounceability(self, syllables, has_vowel):
        if not has_vowel:
            return 0.0
        checks = []
        for syllable in syllables:
            if syllable["onset"]:
                checks.append(self._onset_legal(syllable["onset"]))
            if syllable["coda"]:
                checks.append(self._coda_legal(syllable["coda"]))
        if not checks:
            return 1.0
        return sum(1 for ok in checks if ok) / len(checks)

    def _metric_flow(self, syllables, has_vowel):
        if not has_vowel:
            return 0.0
        good = 0
        transitions = 0
        for syllable in syllables:
            rising = syllable["onset"] + syllable["nucleus"][:1]
            for k, (a, b) in enumerate(zip(rising, rising[1:])):
                transitions += 1
                # English licenses s before a stop (spark, street) outside
                # the sonority slope.
                s_cluster = k == 0 and a == "s" and b in self.s_cluster_stops
                if s_cluster or self.sonority[a] <= self.sonority[b]:
                    good += 1
            falling = syllable["nucleus"][-1:] + syllable["coda"]
            for k, (a, b) in enumerate(zip(falling, falling[1:])):
                transitions += 1
                # A coronal appendix after a coda consonant (flux, glints)
                # is likewise licensed outside the slope.
                appendix = k > 0 and b in self.coda_appendix
                if appendix or self.sonority[a] >= self.sonority[b]:
                    good += 1
        if transitions == 0:
            return self.config["flowNoTransitionScore"]
        return good / transitions

    def _metric_energy(self, tokens):
        if not tokens:
            return 0.0
        total = sum(self.energy_values.get(t, self.energy_default)
                    for t in tokens)
        return total / len(tokens)

    def _metric_phonesthemes(self, letters):
        score = 0.0
        for entry in self.phonesthemes:
            pattern = entry["pattern"]
            position = entry["position"]
            matched = (
                (position == "start" and letters.startswith(pattern))
                or (position == "end" and letters.endswith(pattern))
                or (position == "any" and pattern in letters)
            )
            if matched:
                score += entry["value"]
        score = max(-1.0, min(1.0, score))
        return (score + 1.0) / 2.0

    def _metric_novelty(self, tokens):
        if len(tokens) < 2:
            return self.novelty_cfg["shortWordScore"]
        peak = self.novelty_cfg["peakRarity"]
        width = self.novelty_cfg["width"]
        total = 0.0
        for a, b in zip(tokens, tokens[1:]):
            rarity = self._rarity(a, b)
            total += max(0.0, 1.0 - abs(rarity - peak) / width)
        return total / (len(tokens) - 1)

    def _metric_anchors(self, letters, anchor_context):
        # Leave-one-out: a listed word is judged by how it sounds like the
        # OTHER anchors, never by matching itself.
        cool_entries, uncool_entries = anchor_context
        grams = self._char_bigrams(letters)
        cool = max((self._dice(grams, g) for w, g in cool_entries if w != letters),
                   default=0.0)
        uncool = max((self._dice(grams, g) for w, g in uncool_entries if w != letters),
                     default=0.0)
        return max(0.0, min(1.0, 0.5 + 0.5 * (cool - uncool)))

    def _metric_brevity(self, syllable_count):
        index = min(syllable_count, len(self.brevity)) - 1
        return self.brevity[index]

    # ---- scoring -----------------------------------------------------------

    def parts_of(self, word):
        """A hyphen marks a compound joint (vibe-code): each part keeps
        its own spelling rules, so vibe's silent e stays silent."""
        return [part for part in (self._clean(p) for p in word.split("-")) if part]

    def _tokenize_parts(self, parts):
        tokens = []
        for part in parts:
            part_tokens = self._tokenize(part)
            # A consonant doubled across the joint is still one sound.
            if (tokens and part_tokens and tokens[-1] == part_tokens[0]
                    and part_tokens[0] not in self.vowels):
                part_tokens = part_tokens[1:]
            tokens.extend(part_tokens)
        return tokens

    def score(self, word, weights=None, anchor_context=None):
        parts = self.parts_of(word)
        letters = "".join(parts)
        tokens = self._tokenize_parts(parts)
        syllables = self._syllabify(tokens)
        has_vowel = any(self._vowel_flags(tokens))
        syllable_count = len(syllables) if has_vowel else 1

        metrics = {
            "pronounceability": self._metric_pronounceability(syllables, has_vowel),
            "flow": self._metric_flow(syllables, has_vowel),
            "energy": self._metric_energy(tokens),
            "phonesthemes": self._metric_phonesthemes(letters),
            "novelty": self._metric_novelty(tokens),
            "anchors": self._metric_anchors(
                letters, anchor_context or self.default_anchor_context),
            "brevity": self._metric_brevity(syllable_count),
        }
        metrics = {name: round_places(value, 4) for name, value in metrics.items()}
        return {
            "word": letters,
            "parts": parts,
            "total": self.total_from_metrics(metrics, weights or self.weights),
            "syllables": syllable_count,
            "tokens": tokens,
            "metrics": metrics,
        }

    def legality_gate(self, metrics):
        """Illegal clusters scale the whole score down: a word nobody can
        say is not cool, however its other traits average out."""
        floor = self.config["legalityFloor"]
        return floor + (1.0 - floor) * metrics["pronounceability"]

    def total_from_metrics(self, metrics, weights):
        weight_sum = sum(weights.values())
        if weight_sum <= 0:
            return 0.0
        weighted = sum(weights[name] * metrics[name] for name in weights)
        gate = self.legality_gate(metrics)
        return round_places(100.0 * gate * weighted / weight_sum, 1)


def load_config():
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    validate_formulas(config)
    return config


def validate_formulas(config):
    """Every formula must weight exactly the seven metrics; ids unique."""
    metric_names = set(config["weights"])
    seen_ids = set()
    for formula in config["formulas"]:
        if formula["id"] in seen_ids:
            raise ValueError(f"duplicate formula id: {formula['id']}")
        seen_ids.add(formula["id"])
        if set(formula["weights"]) != metric_names:
            raise ValueError(
                f"formula {formula['id']} weights do not match the metrics: "
                f"{sorted(formula['weights'])} vs {sorted(metric_names)}")


def find_formula(config, formula_id):
    for formula in config["formulas"]:
        if formula["id"] == formula_id:
            return formula
    known = ", ".join(f["id"] for f in config["formulas"])
    raise SystemExit(f"unknown formula '{formula_id}' (known: {known})")


def formula_scoring(scorer, formula):
    """(weights, anchor_context) for scoring under a formula. Persona
    formulas carry their own anchor vocabulary; others use the global one."""
    anchors = formula.get("anchors")
    context = scorer.anchor_context(anchors) if anchors else None
    return formula["weights"], context


def config_digest():
    return hashlib.sha256(CONFIG_PATH.read_bytes()).hexdigest()


def print_pretty(result, weights):
    print(f"\n{result['word']}  ->  {result['total']}/100")
    print(f"  tokens: {'-'.join(result['tokens'])}   syllables: {result['syllables']}")
    for name, value in result["metrics"].items():
        bar = "#" * int(round(value * 20))
        print(f"  {name:17s} {value:6.4f}  w={weights[name]:<5g} {bar}")


def sample_words(config):
    return [word for tier in config["sampleTiers"] for word in tier["words"]]


def calibration(config, totals):
    """How well totals ({word: total}) order the sample tiers: the share
    of word pairs from differently ranked tiers that come out in rank
    order (ties count as misses), plus each tier's mean. Same rule in
    the Word lab (coolness-lab.js)."""
    tiers = config["sampleTiers"]
    good = pairs = 0
    for upper in tiers:
        for lower in tiers:
            if upper["rank"] >= lower["rank"]:
                continue
            for a in upper["words"]:
                for b in lower["words"]:
                    pairs += 1
                    good += totals[a] > totals[b]
    means = {tier["id"]: round_places(
        sum(totals[w] for w in tier["words"]) / len(tier["words"]), 1)
        for tier in tiers}
    return {"pairAccuracy": round_places(good / pairs, 4), "tierMeans": means}


def write_report(scorer, config):
    tier_of = {w: tier["id"] for tier in config["sampleTiers"] for w in tier["words"]}
    words = [dict(scorer.score(word), tier=tier_of[word]) for word in sample_words(config)]
    words.sort(key=lambda row: (-row["total"], row["word"]))
    report = {
        "generatedBy": "coolness.py",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "configDigest": config_digest(),
        "weights": config["weights"],
        "calibration": calibration(config, {row["word"]: row["total"] for row in words}),
        "words": words,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {REPORT_PATH.name}: {len(words)} words, "
          f"top {words[0]['word']} ({words[0]['total']}), "
          f"tier order {report['calibration']['pairAccuracy']:.1%}")


def print_calibration(scorer, config):
    print(f"bigram model: {scorer.bigram_total} bigrams, "
          f"vocab {scorer.bigram_vocab}")
    for formula in config["formulas"]:
        weights, context = formula_scoring(scorer, formula)
        totals = {w: scorer.score(w, weights, context)["total"]
                  for w in sample_words(config)}
        result = calibration(config, totals)
        means = " ".join(f"{k}={v:g}" for k, v in result["tierMeans"].items())
        print(f"  {formula['id']:12s} tier order {result['pairAccuracy']:.1%}  {means}")
    for word in sample_words(config):
        tokens = scorer._tokenize(scorer._clean(word))
        rarities = [scorer._rarity(a, b) for a, b in zip(tokens, tokens[1:])]
        shown = " ".join(f"{r:.1f}" for r in rarities)
        print(f"  {word:12s} {'-'.join(tokens):18s} rarities: {shown}")


def print_formulas(config):
    for formula in config["formulas"]:
        weights = " ".join(f"{name}={value:g}"
                           for name, value in formula["weights"].items())
        print(f"{formula['id']:10s} {formula['name']}: {formula['note']}")
        print(f"{'':10s}   {weights}")


def main(argv):
    config = load_config()
    scorer = Scorer(config)
    args = [a for a in argv if not a.startswith("--")]
    flags = {a for a in argv if a.startswith("--")}

    if "--report" in flags:
        write_report(scorer, config)
        return 0
    if "--calibrate" in flags:
        print_calibration(scorer, config)
        return 0
    if "--formulas" in flags:
        print_formulas(config)
        return 0
    weights = scorer.weights
    anchor_context = None
    if "--formula" in flags:
        # --formula consumes the next positional value as the formula id.
        position = argv.index("--formula")
        if position + 1 >= len(argv):
            raise SystemExit("--formula requires an id (see --formulas)")
        formula_id = argv[position + 1]
        args = [a for a in args if a != formula_id]
        weights, anchor_context = formula_scoring(
            scorer, find_formula(config, formula_id))
    if not args:
        print(__doc__)
        return 1

    results = [scorer.score(word, weights, anchor_context) for word in args]
    if "--json" in flags:
        print(json.dumps(results, indent=2))
    else:
        for result in results:
            print_pretty(result, weights)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
