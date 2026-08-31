#!/usr/bin/env python3
"""Browser-driven smoke test for every CCB Excel and PDF export button."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import socket
import sqlite3
import struct
import subprocess
import tempfile
import time
import urllib.request
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit


APP_ROOT = Path(__file__).resolve().parent
DEFAULT_CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


class CDPClient:
    def __init__(self, websocket_url: str):
        parsed = urlsplit(websocket_url)
        self.socket = socket.create_connection((parsed.hostname, parsed.port or 80), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request_target = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        request = (
            f"GET {request_target} HTTP/1.1\r\n"
            f"Host: {parsed.hostname}:{parsed.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "Origin: http://localhost\r\n\r\n"
        )
        self.socket.sendall(request.encode("ascii"))
        response = self._read_until(b"\r\n\r\n")
        if not response.startswith(b"HTTP/1.1 101"):
            raise RuntimeError(f"Chrome WebSocket upgrade failed: {response.decode('latin-1', errors='replace')}")
        expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest())
        if expected.lower() not in response.lower():
            raise RuntimeError("Chrome returned an invalid WebSocket accept key.")
        self.next_id = 1

    def _read_until(self, marker: bytes) -> bytes:
        data = bytearray()
        while marker not in data:
            block = self.socket.recv(4096)
            if not block:
                raise ConnectionError("Chrome closed the WebSocket connection.")
            data.extend(block)
        return bytes(data)

    def _read_exact(self, size: int) -> bytes:
        data = bytearray()
        while len(data) < size:
            block = self.socket.recv(size - len(data))
            if not block:
                raise ConnectionError("Chrome closed the WebSocket connection.")
            data.extend(block)
        return bytes(data)

    def _send_frame(self, payload: bytes, opcode: int = 1) -> None:
        mask = os.urandom(4)
        length = len(payload)
        header = bytearray([0x80 | opcode])
        if length < 126:
            header.append(0x80 | length)
        elif length <= 0xFFFF:
            header.extend([0x80 | 126])
            header.extend(struct.pack("!H", length))
        else:
            header.extend([0x80 | 127])
            header.extend(struct.pack("!Q", length))
        masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        self.socket.sendall(bytes(header) + mask + masked)

    def _receive_frame(self) -> tuple[int, bytes]:
        first, second = self._read_exact(2)
        opcode = first & 0x0F
        length = second & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._read_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._read_exact(8))[0]
        mask = self._read_exact(4) if second & 0x80 else None
        payload = self._read_exact(length)
        if mask:
            payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        return opcode, payload

    def command(self, method: str, params: dict | None = None, timeout: float = 30) -> dict:
        command_id = self.next_id
        self.next_id += 1
        self._send_frame(json.dumps({"id": command_id, "method": method, "params": params or {}}).encode("utf-8"))
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.socket.settimeout(max(0.1, deadline - time.monotonic()))
            opcode, payload = self._receive_frame()
            if opcode == 8:
                raise ConnectionError("Chrome closed the DevTools connection.")
            if opcode == 9:
                self._send_frame(payload, opcode=10)
                continue
            if opcode != 1:
                continue
            message = json.loads(payload.decode("utf-8"))
            if message.get("id") != command_id:
                continue
            if "error" in message:
                raise RuntimeError(f"{method} failed: {message['error']}")
            return message.get("result", {})
        raise TimeoutError(f"Timed out waiting for {method}.")

    def evaluate(self, expression: str) -> object:
        result = self.command("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
        if result.get("exceptionDetails"):
            raise RuntimeError(f"Browser evaluation failed: {result['exceptionDetails']}")
        return result.get("result", {}).get("value")

    def close(self) -> None:
        try:
            self._send_frame(b"", opcode=8)
        finally:
            self.socket.close()


def wait_for_json(url: str, timeout: float = 20) -> object:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                return json.load(response)
        except Exception as error:
            last_error = error
            time.sleep(0.2)
    raise TimeoutError(f"Timed out waiting for {url}: {last_error}")


def wait_for_browser(client: CDPClient, expression: str, description: str, timeout: float = 30) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if client.evaluate(expression):
            return
        time.sleep(0.2)
    raise TimeoutError(f"Timed out waiting for {description}.")


def wait_for_download(directory: Path, file_name: str, timeout: float = 60) -> Path:
    target = directory / file_name
    deadline = time.monotonic() + timeout
    previous_size = -1
    stable_reads = 0
    while time.monotonic() < deadline:
        partials = list(directory.glob("*.crdownload"))
        if target.is_file() and not partials:
            size = target.stat().st_size
            if size > 0 and size == previous_size:
                stable_reads += 1
                if stable_reads >= 2:
                    return target
            else:
                stable_reads = 0
                previous_size = size
        time.sleep(0.25)
    raise TimeoutError(f"Download did not finish: {file_name}")


def find_source_report(database: Path, locomotive: str) -> Path:
    connection = sqlite3.connect(database)
    row = connection.execute(
        """SELECT r.source_path FROM reports r
           JOIN locomotives l ON l.locomotive_id=r.locomotive_id
           WHERE l.locomotive_number=? ORDER BY r.report_id LIMIT 1""",
        (locomotive,),
    ).fetchone()
    connection.close()
    if not row:
        raise RuntimeError(f"Locomotive {locomotive} has no stored report.")
    source = Path(row[0])
    if not source.is_file():
        raise FileNotFoundError(f"Stored source report is unavailable: {source}")
    return source


def click_and_wait(client: CDPClient, directory: Path, element_id: str, file_name: str) -> Path:
    clicked = client.evaluate(
        f"(() => {{ const button=document.getElementById({json.dumps(element_id)}); if(!button) return false; button.click(); return true; }})()"
    )
    if not clicked:
        raise RuntimeError(f"Export button was not found: {element_id}")
    return wait_for_download(directory, file_name)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--database", type=Path, default=APP_ROOT / "ccb_fleet.sqlite")
    parser.add_argument("--locomotive", default="30417")
    parser.add_argument("--chrome", type=Path, default=DEFAULT_CHROME)
    parser.add_argument("--output-root", type=Path, default=APP_ROOT / "export_test_results")
    args = parser.parse_args()
    if not args.chrome.is_file():
        raise FileNotFoundError(f"Chrome was not found: {args.chrome}")
    wait_for_json(f"{args.base_url}/api/health")
    source_report = find_source_report(args.database, args.locomotive)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_directory = (args.output_root / f"locomotive-{args.locomotive}-{stamp}").resolve()
    output_directory.mkdir(parents=True, exist_ok=False)

    with tempfile.TemporaryDirectory(prefix="ccb-export-chrome-") as profile:
        port = 9333
        chrome = subprocess.Popen(
            [
                str(args.chrome), "--headless=new", "--disable-gpu", "--no-first-run",
                "--disable-default-apps", "--remote-allow-origins=*", f"--remote-debugging-port={port}",
                f"--user-data-dir={profile}", "--window-size=1600,1000", f"{args.base_url}/",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        client: CDPClient | None = None
        try:
            targets = wait_for_json(f"http://127.0.0.1:{port}/json/list")
            target = next(item for item in targets if item.get("type") == "page")
            client = CDPClient(target["webSocketDebuggerUrl"])
            client.command("Page.enable")
            client.command("DOM.enable")
            try:
                client.command("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": str(output_directory), "eventsEnabled": True})
            except RuntimeError:
                client.command("Page.setDownloadBehavior", {"behavior": "allow", "downloadPath": str(output_directory)})
            wait_for_browser(client, "document.readyState === 'complete'", "application page")
            input_result = client.command("Runtime.evaluate", {"expression": "document.getElementById('file-input')"})
            input_object = input_result.get("result", {}).get("objectId")
            if not input_object:
                raise RuntimeError("The report file input was not found.")
            client.command("DOM.setFileInputFiles", {"objectId": input_object, "files": [str(source_report.resolve())]})
            wait_for_browser(
                client,
                "!document.getElementById('dashboard').hidden && document.querySelectorAll('#fault-log-body tr').length > 0",
                "uploaded report analysis",
                timeout=45,
            )
            report_base = source_report.stem
            downloads = []
            for element_id, file_name in (
                ("export-faults-excel", f"{report_base}-chronological-event-log.xlsx"),
                ("export-faults-pdf", f"{report_base}-chronological-event-log.pdf"),
                ("export-population-excel", f"{report_base}-data-population.xlsx"),
                ("export-population-pdf", f"{report_base}-data-population.pdf"),
                ("export-events-excel", f"{report_base}-event-log.xlsx"),
                ("export-events-pdf", f"{report_base}-event-log.pdf"),
            ):
                downloads.append(click_and_wait(client, output_directory, element_id, file_name))

            client.command("Page.navigate", {"url": f"{args.base_url}/?view=locomotive&locomotive={args.locomotive}"})
            wait_for_browser(
                client,
                "document.querySelectorAll('#database-event-body tr').length > 0",
                "stored locomotive database",
                timeout=45,
            )
            for element_id, file_name in (
                ("export-database-excel", f"Locomotive-{args.locomotive}-stored-event-log.xlsx"),
                ("export-database-pdf", f"Locomotive-{args.locomotive}-stored-event-log.pdf"),
            ):
                downloads.append(click_and_wait(client, output_directory, element_id, file_name))

            print(json.dumps({
                "locomotive": args.locomotive,
                "source_report": str(source_report),
                "output_directory": str(output_directory),
                "downloads": [{"name": path.name, "bytes": path.stat().st_size} for path in downloads],
            }, indent=2))
        finally:
            if client:
                try:
                    client.command("Browser.close", timeout=5)
                except Exception:
                    pass
                client.close()
            try:
                chrome.wait(timeout=10)
            except subprocess.TimeoutExpired:
                chrome.terminate()
                chrome.wait(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
