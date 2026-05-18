from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from pathlib import Path
from typing import Any

from blue_so_patch import (
    DEFAULT_MANIFEST_PATH,
    PatchError,
    build_runtime_patch_plan,
    load_manifest,
    runtime_patch_plan_to_dict,
)


MACOS_CAPTURE_DIR = Path.home() / "Library" / "Application Support" / "eve.js" / "macos"
DEFAULT_OUTPUT = MACOS_CAPTURE_DIR / "runtime-blue-so-patch.jsonl"
JS_PATH = Path(__file__).resolve().with_name("runtime_blue_so_patch.js")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Apply the recorded macOS blue.so patch in memory with Frida.",
    )
    parser.add_argument("--blue-so", required=True, help="Path to the unmodified staged blue.so")
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST_PATH), help="Path to the patch manifest.")
    parser.add_argument("--pid", type=int, help="PID of the launched exefile process.")
    parser.add_argument("--process", default="exefile", help="Process name to attach to when --pid is not supplied.")
    parser.add_argument("--module", default="blue.so", help="Runtime module name to patch. Default: blue.so")
    parser.add_argument("--wait-seconds", type=int, default=30, help="How long to wait for the process/module.")
    parser.add_argument("--poll-interval-ms", type=int, default=50, help="Frida module polling interval.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="JSONL output path.")
    return parser.parse_args()


def wait_for_process(device: Any, process_name: str, wait_seconds: int) -> int:
    deadline = time.time() + wait_seconds
    while time.time() < deadline:
        for process in device.enumerate_processes():
            if process.name.lower() == process_name.lower():
                return process.pid
        time.sleep(0.5)
    raise RuntimeError(f"Timed out waiting for process {process_name!r}")


def write_jsonl_line(handle: Any, payload: dict[str, Any]) -> None:
    handle.write(json.dumps(payload, ensure_ascii=True) + "\n")
    handle.flush()


def build_script_source(args: argparse.Namespace) -> str:
    manifest = load_manifest(args.manifest)
    plan = build_runtime_patch_plan(args.blue_so, manifest)
    payload = runtime_patch_plan_to_dict(plan)
    payload["moduleName"] = args.module
    payload["moduleWaitMs"] = max(args.wait_seconds, 1) * 1000
    payload["pollIntervalMs"] = max(args.poll_interval_ms, 10)
    payload["processName"] = args.process
    return JS_PATH.read_text(encoding="utf-8").replace("__PATCH_PLAN__", json.dumps(payload, ensure_ascii=True))


def main() -> int:
    args = parse_args()

    try:
        import frida
    except ImportError as exc:  # pragma: no cover
        print("frida is not installed. Run: python -m pip install --user frida-tools frida", file=sys.stderr)
        raise SystemExit(1) from exc

    script_source = build_script_source(args)
    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    device = frida.get_local_device()
    pid = args.pid if args.pid is not None else wait_for_process(device, args.process, args.wait_seconds)
    try:
        session = device.attach(pid)
    except frida.PermissionDeniedError as exc:
        print(
            "Frida could not attach to the target process. On macOS, enable local developer debugging with:\n"
            "  sudo /usr/sbin/DevToolsSecurity -enable\n"
            "Then allow your terminal app in System Settings > Privacy & Security > Developer Tools if prompted.",
            file=sys.stderr,
        )
        raise SystemExit(1) from exc
    script = session.create_script(script_source)

    patch_complete = threading.Event()
    patch_failed = threading.Event()

    with output_path.open("a", encoding="utf-8") as handle:
        write_jsonl_line(
            handle,
            {
                "type": "host-status",
                "message": "runtime-blue-so-patch-started",
                "pid": pid,
                "process": args.process,
                "module": args.module,
                "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
        )

        def on_message(message: dict[str, Any], data: bytes | None) -> None:
            if message["type"] == "send":
                payload = message["payload"]
                print(json.dumps(payload, ensure_ascii=True))
                write_jsonl_line(handle, payload)
                if payload.get("type") == "patch-complete":
                    patch_complete.set()
                elif payload.get("type") == "patch-error":
                    patch_failed.set()
            else:
                error_payload = {
                    "type": "script-error",
                    "message": message,
                }
                print(json.dumps(error_payload, ensure_ascii=True), file=sys.stderr)
                write_jsonl_line(handle, error_payload)
                patch_failed.set()

        script.on("message", on_message)
        script.load()

        try:
            deadline = time.time() + max(args.wait_seconds, 1) + 5
            while time.time() < deadline:
                if patch_complete.is_set():
                    return 0
                if patch_failed.is_set():
                    return 1
                time.sleep(0.1)
            print("Timed out waiting for runtime blue.so patch completion.", file=sys.stderr)
            return 1
        finally:
            write_jsonl_line(
                handle,
                {
                    "type": "host-status",
                    "message": "runtime-blue-so-patch-stopped",
                    "stoppedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
            )
            script.unload()
            session.detach()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PatchError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
