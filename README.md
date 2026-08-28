# CCB Fault Analyser

A shared LAN web application for chronological CCB Event Log analysis. Every user opens the same URL, and all valid uploads are added to the same SQLite fleet database on the server computer.

## Start the LAN website

Requirements: Windows and Python 3.10 or later on the server computer.

1. Once only, double-click `setup_lan_firewall.cmd` and approve the Administrator prompt.
2. Double-click `CCB Fault Analyser.exe` or `start_lan_server.cmd` on the server computer.
3. Keep the server computer powered on and connected to the LAN.
4. Open `http://10.189.34.5:8080/` in a browser on any LAN computer.

The EXE starts the server in the background and opens `http://127.0.0.1:8080/` on the server computer. The CMD file keeps a visible server console open. PowerShell users can also run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start_lan_server.ps1
```

To stop a background server started by the EXE, double-click `stop_lan_server.cmd`.

Do not open `index.html` directly. The page must be opened through the HTTP URL so it can reach the shared database API.

The server listens on all network interfaces (`0.0.0.0`) at port `8080`. The server computer must actually own the IP address `10.189.34.5`, and Windows Firewall must allow inbound TCP port `8080` on the Private network profile. If the server IP changes, pass the new address to the PowerShell launcher:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start_lan_server.ps1 -LanIp "10.189.34.27"
```

## Existing and future database data

- `ccb_fleet.sqlite` is the single master database used by the web server.
- Existing rows are retained; startup does not rebuild or clear the database.
- The initial shared database contains 71 locomotives, 168 reports, and 28,000 Event Log rows.
- New valid uploads append reports and non-duplicate events to this same file, so all LAN users see the expanded data.
- Complete raw TXT content, Event Log rows, Loading Log, Stored Fault Log, software version, source client, and import audit details are retained.
- SQLite WAL mode permits reads while an upload is being written. Upload writes are serialized to keep duplicate checking atomic.
- Event duplicate identity is locomotive number + paired fault-occurrence start second + event code + state.
- Exact duplicate files and fully overlapping reports are rejected without adding a second report.

Before the conversion, the original database was copied to `backups/ccb_fleet_before_lan_server.sqlite`. Make regular copies of `ccb_fleet.sqlite` while the server is stopped as the database grows.

## Docker deployment

The application has no third-party Python packages. On a Windows or Linux server with Docker and Docker Compose installed, copy this project directory to the server and run:

```text
docker compose up -d --build
```

Open `http://SERVER-IP:8080/` from another LAN computer. Check status and logs with:

```text
docker compose ps
docker compose logs -f analyser
```

The existing `ccb_fleet.sqlite` is copied into the `ccb-fleet-data` named volume only when that volume is first created. All later uploads remain in that volume across `docker compose down`, image rebuilds, and container replacement. Do not run `docker compose down -v`, because `-v` intentionally deletes the database volume.

To use a different host port, set `CCB_PORT` before starting. For example, PowerShell can use `$env:CCB_PORT=8090` and then `docker compose up -d --build`.

For a trusted LAN, users can connect directly to the published port. For internet exposure, place the app behind an authenticated HTTPS reverse proxy; the built-in server intentionally does not provide user accounts or TLS.

## Fleet database behavior

- Single and bulk TXT uploads are supported.
- Locomotive number is read from report text first, then the filename, then the uploaded folder name.
- Fleet retrieval defaults to latest date/time first.
- Every stored Event Log row includes MRT, BPT, BPalt, ERT, 20TL, 20TT, 10T, BCT, and FLT in raw and converted kg/cm² form.
- The Fleet Database and Analysis of Data views read live data from the shared server.
- Fault matrices and totals are recalculated from all stored reports.

## Tabulation rules

- Only rows in the `Event Log Data` section are analysed.
- Internal timestamps are parsed as `MM:DD:YYYY::HH:MM:SS`.
- A `Fail` row starts a fault occurrence; the next matching `Pass` clears it.
- Rows are sorted by timestamp because the record number is circular.
- Power Up (`On`), activation (`Fail`), and clearance (`Pass`) rows are counted separately.
- Pressure conversion is `kg/cm² = (raw ÷ 10) × 0.0703069579`.
- Raw A2D, Trgt, and AW4 Press are retained but omitted from visible analysis.
- Filtered tables can be downloaded as genuine Excel (`.xlsx`) workbooks or PDF documents.
