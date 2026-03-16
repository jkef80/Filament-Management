#!/usr/bin/env python3
"""
ws_dump.py — Creality K2 Plus WebSocket raw message dumper

Connects to ws://<host>:9999, sends only heartbeats to keep the
connection alive, and dumps EVERY message the printer pushes to
stdout and an optional JSONL log file.

The printer streams data continuously — temperatures, status, CFS
slot events — without needing to be polled for most of it. This
script captures everything as-is so you can analyse the full protocol.

Usage:
    python3 ws_dump.py <printer-ip> [output-file]

Example:
    python3 ws_dump.py 192.168.1.144
    python3 ws_dump.py 192.168.1.144 capture.jsonl

Requirements:
    pip install websockets   (same venv as the main app)

What to look for:
    - "rfid" fields inside materialBoxs → unique spool RFID ID
    - "materialState" → fires on spool insert/remove/scan
    - Any top-level key you haven't seen before (marked with ***)
    - Insert a spool while running and watch what bursts come through
"""

import asyncio
import json
import sys
import time
from datetime import datetime

try:
    import websockets
except ImportError:
    print("ERROR: websockets not installed. Run: pip install websockets")
    sys.exit(1)

HEARTBEAT_INTERVAL = 10.0   # seconds between heartbeats
RECV_TIMEOUT       = 15.0   # seconds of silence before sending a keepalive

HEARTBEAT_REQ = json.dumps({"ModeCode": "heart_beat"})

seen_keys: set[str] = set()


def ts() -> str:
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


def pretty(obj) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False)


def annotate(raw: str) -> list[str]:
    """Return human-readable notes about interesting fields in a message."""
    notes = []
    try:
        d = json.loads(raw)
    except Exception:
        return notes

    # Track new top-level keys
    global seen_keys
    new = set(d.keys()) - seen_keys
    if new:
        seen_keys |= new
        notes.append(f"  *** NEW TOP-LEVEL KEYS: {sorted(new)}")

    # RFID fields inside boxsInfo
    boxes = (d.get("boxsInfo") or {}).get("materialBoxs") or []
    for box in boxes:
        for mat in (box.get("materials") or []):
            rfid = mat.get("rfid", "")
            state = mat.get("state", 0)
            slot_letter = "ABCD"[mat["id"]] if isinstance(mat.get("id"), int) and 0 <= mat["id"] <= 3 else "?"
            slot = f"{box.get('id', '?')}{slot_letter}"
            if rfid:
                notes.append(
                    f"  >>> RFID slot {slot}: {rfid!r}  state={state} "
                    f"({'RFID chip' if state == 2 else 'manual' if state == 1 else 'empty'})"
                )
            elif state > 0:
                notes.append(f"  --- slot {slot}: no rfid  state={state}  material={mat.get('type','?')}")

    # materialState — fires on spool events
    if "materialState" in d:
        notes.append(f"  >>> materialState: {d['materialState']}")

    # deviceState / state — printer status
    if "deviceState" in d:
        notes.append(f"  >>> deviceState: {d['deviceState']}")
    if "state" in d:
        notes.append(f"  >>> state: {d['state']}")

    return notes


async def dump(host: str, out_path: str | None) -> None:
    url = f"ws://{host}:9999"
    print(f"[{ts()}] Connecting to {url} ...")

    out_file = None
    if out_path:
        out_file = open(out_path, "a", encoding="utf-8")
        print(f"[{ts()}] Logging raw messages to {out_path}")

    def log(raw: str, direction: str = "RECV") -> None:
        if out_file:
            out_file.write(json.dumps({
                "t": time.time(),
                "ts": ts(),
                "dir": direction,
                "raw": raw,
            }) + "\n")
            out_file.flush()

    async with websockets.connect(
        url,
        ping_interval=None,
        ping_timeout=None,
        close_timeout=5,
        max_size=2**22,
    ) as ws:
        print(f"[{ts()}] Connected — listening passively (heartbeat only)\n")
        print("  Insert / remove a spool and watch for events marked >>>")
        print("  Newly seen message types are marked ***")
        print("  Press Ctrl+C to stop\n")

        last_heartbeat = time.time()

        async def heartbeat_loop() -> None:
            nonlocal last_heartbeat
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL)
                await ws.send(HEARTBEAT_REQ)
                log(HEARTBEAT_REQ, "SEND")
                last_heartbeat = time.time()

        asyncio.create_task(heartbeat_loop())

        async for raw in ws:
            log(raw)

            if raw == "ok":
                print(f"[{ts()}] heartbeat ack")
                continue

            try:
                parsed = json.loads(raw)
            except Exception:
                print(f"[{ts()}] non-JSON: {raw[:300]}")
                continue

            top_keys = list(parsed.keys())
            print(f"[{ts()}] keys={top_keys}")

            for note in annotate(raw):
                print(note)

            # Full dump for boxsInfo (richest payload)
            if "boxsInfo" in parsed:
                print(pretty(parsed))
            print()


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: python3 {sys.argv[0]} <printer-ip> [output.jsonl]")
        sys.exit(1)

    host = sys.argv[1]
    out  = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        asyncio.run(dump(host, out))
    except KeyboardInterrupt:
        print("\nStopped.")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
