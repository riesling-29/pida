#!/usr/bin/env python3
"""Actual pinned-PIX acceptance check, separate from scripted-model tests.

Inputs are synthetic; computation is the real, byte-verified PIX Python source.
No Schumpeter package, LLM, Persona server, installation or network is required.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

COMMIT = "3205d832d5dcdc6901f916b35496a0c60b657e7a"
DIGEST = "b4fef3bce21c49dd4ab700b6188bdef16f9813810718932b23029522609c7510"
SCHEMA = "pida.pix.worker.v1"


def trace(case_id, activities):
    return {"caseId": case_id, "events": [{"eventId": f"{case_id}:{i}", "activity": activity} for i, activity in enumerate(activities)]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--write-fixtures", type=Path)
    args = parser.parse_args()
    worker = Path(__file__).resolve().with_name("pix-worker.py")
    command = [sys.executable, "-I", "-B", str(worker), "--source", str(args.source.resolve()), "--source-commit", COMMIT, "--source-digest", DIGEST]
    checks, artifacts = [], {}

    def call(request, *, name=None, argv=None, raw=None):
        payload = raw if raw is not None else json.dumps(request, separators=(",", ":")).encode()
        with tempfile.TemporaryDirectory(prefix="pida-pix-check-") as cwd:
            result = subprocess.run(argv or command, input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=cwd, timeout=20, check=True)
        assert not result.stderr, "worker must not expose raw diagnostics"
        value = json.loads(result.stdout)
        if name:
            artifacts[name + ".request.json"] = json.loads(payload)
            artifacts[name + ".result.json"] = value
        return value

    def checked(name, condition):
        assert condition, name
        checks.append(name)

    capabilities = call({"schemaVersion": SCHEMA, "operation": "capabilities"})
    checked("actual pinned engine loads from isolated different cwd", capabilities["status"] == "computed" and capabilities["engine"]["sourceDigest"] == DIGEST)
    training = [trace(f"ordinary-{i}", ["request", "edit", "test", "deliver"]) for i in range(12)]
    training += [trace(f"reproduced-{i}", ["request", "reproduce", "edit", "test", "deliver"]) for i in range(6)]
    training += [trace(f"failed-{i}", ["request", "tool_error", "abort"]) for i in range(2)]
    request = {"schemaVersion": SCHEMA, "operation": "reflect", "traces": training}
    reflected = call(request, name="reflection")
    checked("catalog includes 20 cases and failure variants", reflected["status"] == "computed" and reflected["sampleCount"] == 20 and [v["frequency"] for v in reflected["variants"]] == [12, 6, 2])
    checked("case coverage denominator remains 20", [v["cumulativeCaseCount"] for v in reflected["variants"]] == [12, 18, 20])
    checked("repeated calculation has identical native result identities", reflected == call(request))
    native_ids = {r["computation"]["computation_id"] for r in reflected["nativeResults"]}
    checked("native parent lineage resolves", all(set(r["computation"]["parent_computation_ids"]) <= native_ids for r in reflected["nativeResults"]))
    checked("public native result version is preserved", all(r["format"] == "pix.analysis-result" and r["version"] == "1.3.0" for r in reflected["nativeResults"]))
    model = reflected["model"]
    evaluation = {"schemaVersion": SCHEMA, "operation": "awareness", "model": model, "traces": [trace("heldout-conforming", ["request", "edit", "test", "deliver"])]}
    aligned = call(evaluation, name="awareness-conforming")
    checked("separate evaluation case conforms to frozen model", aligned["status"] == "computed" and aligned["alignments"][0]["cost"] == 0)
    evaluation["traces"] = [trace("heldout-extra-review", ["request", "reproduce", "edit", "test", "review", "deliver"])]
    deviated = call(evaluation, name="awareness-deviation")
    checked("extra review is observable deviation without an obligation verdict", deviated["status"] == "computed" and deviated["alignments"][0]["cost"] == 1 and "acceptance" not in deviated and "violation" not in deviated)
    limited = call({**evaluation, "limits": {"maxStates": 1}}, name="awareness-limited")
    checked("bounded search is partial and not a fabricated fitness score", limited["status"] == "partial" and limited["alignments"][0]["status"] == "search_limit" and limited["alignments"][0]["cost"] is None)
    partial = call({**request, "limits": {"maxEventPairs": 1}}, name="reflection-limited")
    checked("incomplete discovery cannot publish a frozen model", partial["status"] == "partial" and "model" not in partial)
    unavailable = call({**request, "limits": {"maxVariants": 1}})
    checked("catalog cap never silently truncates variants", unavailable["status"] == "unavailable" and "model" not in unavailable and "variants" not in unavailable)
    empty = call({"schemaVersion": SCHEMA, "operation": "reflect", "traces": []})
    checked("empty population is unavailable", empty["status"] == "unavailable" and empty["sampleCount"] == 0)
    bad = call({**request, "owner": "invented-owner"})
    checked("unknown input fields fail closed", bad["status"] == "invalid_input")
    duplicate = call({"schemaVersion": SCHEMA, "operation": "reflect", "traces": [trace("duplicate", ["a"]), trace("duplicate", ["b"])]})
    checked("duplicate case identities are rejected", duplicate["status"] == "invalid_input")
    shared_event = call({"schemaVersion": SCHEMA, "operation": "reflect", "traces": [{"caseId": "a", "events": [{"eventId": "shared", "activity": "a"}]}, {"caseId": "b", "events": [{"eventId": "shared", "activity": "b"}]}]})
    checked("cross-case shared events cannot become independent sequential cases", shared_event["status"] == "invalid_input")
    pin_failure = call({"schemaVersion": SCHEMA, "operation": "capabilities"}, argv=[*command[:-1], "0" * 64])
    checked("unsupported source pin is unavailable before import", pin_failure["status"] == "unavailable" and "engine" not in pin_failure)
    malformed = call(None, raw=b'{"schemaVersion":"pida.pix.worker.v1","operation":"reflect","operation":"capabilities"}')
    checked("duplicate JSON members are rejected", malformed["status"] == "invalid_input")
    order = call({"schemaVersion": SCHEMA, "operation": "reflect", "traces": [trace("order", ["z", "a"])]})
    checked("source order is not replaced by label sorting", order["variants"][0]["activities"] == ["z", "a"])

    evidence = {
        "schemaVersion": "pida.pix.acceptance.v1", "inputProfile": "synthetic",
        "computationProfile": "real-pinned-pix-source", "llmProfile": "not-used",
        "personaIntegration": "NOT_RUN", "schumpeterDependency": "none",
        "engine": reflected["engine"], "workerSha256": hashlib.sha256(worker.read_bytes()).hexdigest(),
        "checks": checks, "passed": len(checks), "failed": 0,
        "limits": ["Sequential batch projection only", "No live agent or long-term improvement claim", "No native Windows or actual Persona integration"],
    }
    if args.write_fixtures:
        args.write_fixtures.mkdir(parents=True, exist_ok=True)
        hashes = {}
        for name, value in artifacts.items():
            payload = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()
            (args.write_fixtures / name).write_bytes(payload)
            hashes[name] = hashlib.sha256(payload).hexdigest()
        evidence["artifactDigests"] = hashes
        (args.write_fixtures / "evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps({"passed": len(checks), "failed": 0, "profile": evidence["computationProfile"], "sourceCommit": COMMIT, "sourceDigest": DIGEST}, indent=2))


if __name__ == "__main__":
    main()
