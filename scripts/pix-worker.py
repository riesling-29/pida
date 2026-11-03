#!/usr/bin/env python3
"""Pida consumer of a pinned, unmodified PIX source build (JSON stdin/stdout).

This file owns domain adaptation, never discovery or alignment algorithms.
Invoke with an isolated Python interpreter and the explicit host-selected source.
"""
from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
from pathlib import Path
import sys
import tempfile

SCHEMA = "pida.pix.worker.v1"
SOURCE_COMMIT = "3205d832d5dcdc6901f916b35496a0c60b657e7a"
SOURCE_DIGEST = "b4fef3bce21c49dd4ab700b6188bdef16f9813810718932b23029522609c7510"
MAX_INPUT_BYTES = 2 * 1024 * 1024
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
BOUNDARIES = [
    "Completed source-sequence runs only; no live-current-cut or concurrent semantics.",
    "DFG accepting-language conformance reports edit cost, not normalized fitness or business acceptance.",
    "Discovery may generalize recombinations; zero cost does not prove an exact previously observed trace.",
    "Empirical deviation does not authorize correction, identity change or tool execution.",
]


class ContractError(ValueError):
    def __init__(self, code: str, message: str):
        self.code, self.message = code, message
        super().__init__(message)


def obj(value, required, optional=()):
    if type(value) is not dict or not set(required) <= set(value) or set(value) - set(required) - set(optional):
        raise ContractError("invalid_input", "Object fields do not match the worker contract.")


def text(value):
    if type(value) is not str or not value.strip() or len(value) > 256:
        raise ContractError("invalid_input", "Identifiers and activity labels must be 1–256 characters.")
    return value


def integer(value, maximum):
    if type(value) is not int or not 1 <= value <= maximum:
        raise ContractError("invalid_input", "Analysis budget is outside the supported bounds.")
    return value


def unique_members(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ContractError("invalid_input", "Duplicate JSON member.")
        result[key] = value
    return result


def invalid_constant(_value):
    raise ContractError("invalid_input", "Nonfinite JSON number.")


def response(operation, status, engine=None, issues=None, **values):
    result = {
        "schemaVersion": SCHEMA, "operation": operation, "status": status,
        "issues": issues or [], "nativeResults": [], "limits": BOUNDARIES,
    }
    if engine is not None:
        result["engine"] = engine
    return {**result, **values}


def verify_source(args):
    if args.source_commit != SOURCE_COMMIT or args.source_digest != SOURCE_DIGEST:
        raise ContractError("unsupported_build", "This worker supports only its documented PIX source pin.")
    root = Path(args.source)
    if not root.is_absolute() or not root.is_dir() or root.is_symlink():
        raise ContractError("source_unavailable", "The configured source directory is unavailable.")
    package = root / "src" / "pix"
    if not package.is_dir() or (root / "src").is_symlink() or package.is_symlink():
        raise ContractError("source_unavailable", "The configured source has no PIX Python package.")
    if any(item.name != "pix" for item in (root / "src").iterdir()):
        raise ContractError("source_mismatch", "Unexpected import roots accompany the pinned package.")
    files, source_bytes, total_bytes = [], {}, 0
    for item in package.rglob("*"):
        if item.is_symlink():
            raise ContractError("source_mismatch", "Symlinks are not supported within the pinned source.")
        if item.is_file() and item.suffix.lower() in (".pyc", ".pyo", ".so", ".pyd", ".dll"):
            raise ContractError("source_mismatch", "Unverified executable caches are not supported within the source.")
        if item.is_file() and item.suffix == ".py":
            if item.stat().st_size > 1024 * 1024:
                raise ContractError("source_mismatch", "Source file exceeds the verified build bounds.")
            data = item.read_bytes()
            total_bytes += len(data)
            if len(files) >= 240 or total_bytes > 8 * 1024 * 1024:
                raise ContractError("source_mismatch", "Source package exceeds the verified build bounds.")
            path = item.relative_to(root).as_posix()
            source_bytes[path] = data
            files.append([path, hashlib.sha256(data).hexdigest()])
    encoded = json.dumps(sorted(files), ensure_ascii=False, separators=(",", ":")).encode()
    actual = hashlib.sha256(encoded).hexdigest()
    if len(files) != 240 or actual != SOURCE_DIGEST:
        raise ContractError("source_mismatch", "PIX Python source bytes differ from the supported build.")
    # Import the bytes just verified, not mutable files that could change between
    # hashing and import. This is an ephemeral consumer copy, not a PIX fork.
    # The process adapter owns this cwd and cleans it even after worker cancellation.
    snapshot = tempfile.TemporaryDirectory(prefix="pida-pix-code-", dir=".")
    try:
        for path, data in source_bytes.items():
            target = Path(snapshot.name) / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        # -I ignores PYTHONPATH and user site packages; this is the only added root.
        sys.path.insert(0, str(Path(snapshot.name) / "src"))
        import pix
        if pix.__version__ != "0.5.0":
            raise ContractError("source_mismatch", "Unexpected PIX package version.")
        return {
            "repository": "Chanta-Research-Group/PIX", "sourceCommit": SOURCE_COMMIT,
            "sourceDigest": actual, "packageVersion": pix.__version__,
            "pythonVersion": ".".join(map(str, sys.version_info[:3])), "sourceVerified": True,
        }, snapshot
    except BaseException:
        snapshot.cleanup()
        raise


def validate_request(request):
    obj(request, ("schemaVersion", "operation"), ("traces", "model", "limits"))
    if request["schemaVersion"] != SCHEMA:
        raise ContractError("unsupported_schema", "Unsupported worker request schema.")
    operation = request["operation"]
    if operation not in ("reflect", "awareness", "capabilities"):
        raise ContractError("unsupported_operation", "Unsupported PIX worker operation.")
    raw_limits = request.get("limits", {})
    obj(raw_limits, (), ("maxEvents", "maxVariants", "maxStates", "maxEventPairs"))
    ceilings = {"maxEvents": 10000, "maxVariants": 1000, "maxStates": 100000, "maxEventPairs": 10000}
    limits = {key: integer(raw_limits.get(key, bound), bound) for key, bound in ceilings.items()}
    if operation == "capabilities":
        if "traces" in request or "model" in request:
            raise ContractError("invalid_input", "Capabilities requests have no trace or model input.")
        return operation, [], None, limits
    traces = request.get("traces")
    if type(traces) is not list or len(traces) > 256:
        raise ContractError("invalid_input", "Expected at most 256 traces.")
    cases, events, activities, count = set(), set(), set(), 0
    for trace in traces:
        obj(trace, ("caseId", "events"))
        case_id = text(trace["caseId"])
        if case_id in cases or type(trace["events"]) is not list:
            raise ContractError("invalid_input", "Duplicate case or invalid event collection.")
        cases.add(case_id)
        count += len(trace["events"])
        if count > limits["maxEvents"]:
            raise ContractError("event_limit", "Trace input exceeds the configured event budget.")
        for event in trace["events"]:
            obj(event, ("eventId", "activity"))
            event_id = text(event["eventId"])
            text(event["activity"])
            activities.add(event["activity"])
            if len(activities) > 256:
                raise ContractError("activity_limit", "At most 256 distinct activity labels are supported.")
            if event_id in events:
                raise ContractError("invalid_input", "Duplicate event identity across cases.")
            events.add(event_id)
    model = request.get("model")
    if operation == "reflect" and "model" in request:
        raise ContractError("invalid_input", "Reflection must not replace or reuse an input model.")
    if operation == "awareness":
        obj(model, ("activities", "edges", "starts", "ends", "acceptsEmpty"))
        for key in ("activities", "starts", "ends"):
            value = model[key]
            if type(value) is not list or len(value) > 256 or len(set(map(text, value))) != len(value):
                raise ContractError("invalid_input", "Model labels must be a unique bounded list.")
        edges = model["edges"]
        if type(edges) is not list or len(edges) > 10000 or any(type(edge) is not list or len(edge) != 2 for edge in edges):
            raise ContractError("invalid_input", "Expected bounded activity edge pairs.")
        pairs = [(text(edge[0]), text(edge[1])) for edge in edges]
        if len(set(pairs)) != len(pairs) or type(model["acceptsEmpty"]) is not bool:
            raise ContractError("invalid_input", "Duplicate edges or invalid empty-word policy.")
        labels = set(model["activities"])
        if not set(model["starts"] + model["ends"]).issubset(labels) or any(a not in labels or b not in labels for a, b in pairs):
            raise ContractError("invalid_input", "Model boundary and edge labels must be declared activities.")
    return operation, traces, model, limits


def compute(request, engine):
    operation, traces, model, limits = validate_request(request)
    if operation == "capabilities":
        return response(operation, "computed", engine)
    if not traces:
        return response(operation, "unavailable", engine, [{"code": "empty_population", "message": "No completed cases were supplied."}], sampleCount=0)
    from pix.event_log import CaseAttribute, CaseEvent, CaseLog, CaseTrace, case_traces
    from pix.results import result_document
    from pix.contracts.result import ComputeStatus
    log = CaseLog(tuple(CaseTrace(t["caseId"], tuple(CaseEvent(e["eventId"], (CaseAttribute("concept:name", "string", e["activity"]),)) for e in t["events"])) for t in traces))
    ordered = case_traces(log)
    native = [result_document(ordered)]
    if operation == "reflect":
        from pix.case_centric.trace_catalog import TraceCatalogSpec, catalog_trace_variants
        from pix.case_centric.discovery import RelationDiscoverySpec, discover_dfg
        catalog = catalog_trace_variants(log, spec=TraceCatalogSpec(top_variant_percent=100, max_variants=limits["maxVariants"], max_events=limits["maxEvents"]))
        discovery = discover_dfg(ordered, RelationDiscoverySpec(max_event_pairs=limits["maxEventPairs"]))
        native += [result_document(catalog), result_document(discovery)]
        results = (catalog, discovery)
        issues = [{"code": code, "message": message} for code, message in sorted({(issue.code, issue.message) for r in results for issue in r.issues})]
        status = "computed" if all(r.status is ComputeStatus.COMPUTED for r in results) else "partial" if any(r.status is ComputeStatus.PARTIAL for r in results) else "unavailable"
        values = {"sampleCount": len(traces), "nativeResults": native}
        if catalog.status is ComputeStatus.COMPUTED:
            values["variants"] = [{"variantId": v.id, "caseIds": list(v.case_ids), "activities": list(v.activities), "frequency": v.frequency, "cumulativeCaseCount": v.cumulative_case_count} for v in catalog.value.variants]
        # An incomplete graph must never become a frozen reference language.
        if status == "computed":
            graph = discovery.value
            values["model"] = {"activities": [a for a, _ in graph.activity_counts], "edges": [[e.source, e.target] for e in graph.edges], "starts": [a for a, _ in graph.start_counts], "ends": [a for a, _ in graph.end_counts], "acceptsEmpty": graph.empty_trace_count > 0}
        return response(operation, status, engine, issues, **values)
    from pix.case_centric.sequence_alignment import DFGAlignmentModel, DFGAlignmentSpec, align_dfg
    fixed = DFGAlignmentModel(tuple(model["activities"]), tuple(tuple(edge) for edge in model["edges"]), tuple(model["starts"]), tuple(model["ends"]), model["acceptsEmpty"])
    result = align_dfg(ordered, fixed, DFGAlignmentSpec(max_states=limits["maxStates"]))
    native.append(result_document(result))
    values = {"sampleCount": len(traces), "nativeResults": native}
    if result.value is not None:
        values["alignments"] = [{"caseId": t.case_id, "status": t.status, "cost": t.cost, "moves": [dataclasses.asdict(m) for m in t.moves], "lowerBoundCost": t.lower_bound_cost} for t in result.value.traces]
    return response(operation, result.status.value, engine, [{"code": code, "message": message} for code, message in sorted({(issue.code, issue.message) for issue in result.issues})], **values)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--source-digest", required=True)
    args = parser.parse_args()
    operation, engine, source_snapshot = "capabilities", None, None
    try:
        payload = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        if len(payload) > MAX_INPUT_BYTES:
            raise ContractError("input_limit", "Worker input exceeds 2 MiB.")
        request = json.loads(payload.decode("utf-8"), object_pairs_hook=unique_members, parse_constant=invalid_constant)
        operation = request.get("operation", "capabilities") if type(request) is dict else "capabilities"
        if operation not in ("reflect", "awareness", "capabilities"):
            operation = "capabilities"
        validate_request(request)
        engine, source_snapshot = verify_source(args)
        result = compute(request, engine)
    except ContractError as exc:
        status = "unavailable" if exc.code in ("source_unavailable", "source_mismatch", "unsupported_build") else "invalid_input"
        result = response(operation, status, engine, [{"code": exc.code, "message": exc.message}])
    except (UnicodeError, json.JSONDecodeError):
        result = response(operation, "invalid_input", engine, [{"code": "invalid_json", "message": "Expected a single UTF-8 JSON object."}])
    except Exception:
        # Do not leak local paths or source/request values through raw exceptions.
        result = response(operation, "error", engine, [{"code": "engine_error", "message": "The pinned PIX call or native result serialization failed."}])
    finally:
        if source_snapshot is not None:
            source_snapshot.cleanup()
    encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    if len(encoded) > MAX_OUTPUT_BYTES:
        encoded = json.dumps(response(operation, "unavailable", engine, [{"code": "output_limit", "message": "Native results exceed the 4 MiB response budget; no truncated result is accepted."}]), separators=(",", ":")).encode()
    sys.stdout.buffer.write(encoded + b"\n")


if __name__ == "__main__":
    main()
