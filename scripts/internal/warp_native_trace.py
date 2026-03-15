from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

try:
    import frida
except ImportError as exc:  # pragma: no cover - operator guidance
    print("frida is not installed. Run: python -m pip install --user frida-tools frida", file=sys.stderr)
    raise SystemExit(1) from exc


REPO_ROOT = Path(__file__).resolve().parents[2]
JS_PATH = REPO_ROOT / "scripts" / "internal" / "warp_native_trace.js"
DEFAULT_OUTPUT = REPO_ROOT / "server" / "logs" / "warp-native-frida.jsonl"


class TraceState:
    def __init__(self) -> None:
        self.current_warp_sequence: int | None = None
        self.first_post_warp_88_writer_logged = False

    def observe(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        derived: list[dict[str, Any]] = []

        if payload.get("type") == "write" and payload.get("site") == "warp-to-write-minus-one":
            self.current_warp_sequence = payload.get("warpSequence")
            self.first_post_warp_88_writer_logged = False

        if (
            payload.get("type") == "write"
            and payload.get("field") == "+0x88"
            and payload.get("site") != "warp-to-write-minus-one"
            and self.current_warp_sequence is not None
            and payload.get("warpSequence") == self.current_warp_sequence
            and not self.first_post_warp_88_writer_logged
        ):
            self.first_post_warp_88_writer_logged = True
            derived.append(
                {
                    "type": "derived",
                    "kind": "first-post-warp-write-88",
                    "warpSequence": self.current_warp_sequence,
                    "firstWriterSite": payload.get("site"),
                    "writerAddress": payload.get("address"),
                    "newValue": payload.get("newValue"),
                    "snapshot": payload.get("snapshot"),
                }
            )

        return derived


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Trace native warp activation writes inside exefile.exe")
    parser.add_argument("--process", default="exefile.exe", help="Process name to attach to")
    parser.add_argument("--ship-id", type=int, default=None, help="Optional ship entity ID to pin as the ego ball")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="JSONL output path")
    parser.add_argument("--wait-seconds", type=int, default=120, help="How long to wait for the client process")
    parser.add_argument("--duration-seconds", type=int, default=0, help="Optional auto-stop duration after attach; 0 means until Ctrl+C")
    return parser.parse_args()


def wait_for_process(device: frida.core.Device, process_name: str, wait_seconds: int) -> int:
    deadline = time.time() + wait_seconds
    while time.time() < deadline:
        for process in device.enumerate_processes():
            if process.name.lower() == process_name.lower():
                return process.pid
        time.sleep(1)
    raise RuntimeError(f"Timed out waiting for process {process_name!r}")


def build_script_source(ship_id: int | None) -> str:
    source = JS_PATH.read_text(encoding="utf-8")
    config = {"shipId": ship_id}
    return source.replace("__TRACE_CONFIG__", json.dumps(config))


def write_jsonl_line(handle: Any, payload: dict[str, Any]) -> None:
    handle.write(json.dumps(payload, ensure_ascii=True) + "\n")
    handle.flush()


def main() -> int:
    args = parse_args()
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    device = frida.get_local_device()
    pid = wait_for_process(device, args.process, args.wait_seconds)
    session = device.attach(pid)
    tracer_state = TraceState()

    source = build_script_source(args.ship_id)
    script = session.create_script(source)

    start_time = time.time()
    with output_path.open("a", encoding="utf-8") as handle:
        write_jsonl_line(
            handle,
            {
                "type": "host-status",
                "message": "trace-started",
                "process": args.process,
                "pid": pid,
                "shipId": args.ship_id,
                "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(start_time)),
            },
        )

        def on_message(message: dict[str, Any], data: bytes | None) -> None:
            if message["type"] == "send":
                payload = message["payload"]
                print(json.dumps(payload, ensure_ascii=True))
                write_jsonl_line(handle, payload)
                if isinstance(payload, dict):
                    for derived in tracer_state.observe(payload):
                        print(json.dumps(derived, ensure_ascii=True))
                        write_jsonl_line(handle, derived)
            else:
                error_payload = {
                    "type": "script-error",
                    "message": message,
                }
                print(json.dumps(error_payload, ensure_ascii=True), file=sys.stderr)
                write_jsonl_line(handle, error_payload)

        script.on("message", on_message)
        script.load()

        try:
            if args.duration_seconds > 0:
                time.sleep(args.duration_seconds)
            else:
                while True:
                    time.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            end_time = time.time()
            write_jsonl_line(
                handle,
                {
                    "type": "host-status",
                    "message": "trace-stopped",
                    "stoppedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(end_time)),
                },
            )
            script.unload()
            session.detach()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
