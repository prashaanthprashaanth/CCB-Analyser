# CCB Fault Analyser

An offline browser tool for producing chronological CCB Event Log analysis with environment data while retaining Loading Log and Stored Fault Log history separately.

## Open the analyser

Double-click `index.html` or run `CCB Fault Analyser.exe`, then drop one or several CCB `.txt` reports onto the upload area. No internet connection is required; reports are processed locally.

## Fleet database

- Single and bulk TXT uploads are supported.
- Locomotive number is read from the report text first and falls back to the filename only when the report value is unavailable.
- Parsed reports, their complete raw TXT, Event Log rows, Loading Log, Stored Fault Log, and software version are persisted in browser IndexedDB.
- The `locomotives` store uses locomotive number as its primary key.
- Event duplicate identity uses locomotive number, paired fault-occurrence start second, event code, and state.
- A locomotive-and-timestamp index retrieves each locomotive’s events chronologically.
- Fleet retrieval defaults to latest date/time first, followed by progressively older records.
- Every database Event Log record includes MRT, BPT, BPalt, ERT, 20TL, 20TT, 10T, BCT, and FLT as raw values and converted kg/cm² environment parameters.
- Duplicate identities are skipped within one TXT and across later overlapping files; different faults in the same second remain valid.
- Fleet Database and Analysis of Data can be opened later from the left Options drawer without importing the files again.
- The Analysis of Data fault matrix includes a Fault Name checkbox filter; every fault is selected by default and deselected faults are omitted while visible ranks and totals are recalculated.

## Tabulation rules

- Only rows in the `Event Log Data` section are analysed.
- Internal timestamps are parsed as `MM:DD:YYYY::HH:MM:SS`.
- The first report value (for example, `2537_240508`) is stored as the software version used while downloading the data.
- The current software version is displayed at the top-right and its recent file history is retained locally in browser storage.
- Loading Log rows are parsed into installation date, time, user ID, filename, and installed software version, then saved in a separate local history.
- Stored `Fault Log Data` is kept separate from `Event Log Data` and saved with its status, cumulative count, last-failed time, and last-cleared time.
- Rows are sorted by timestamp because the record number is a circular counter.
- A `Fail` row starts a fault occurrence.
- The next `Pass` with the same Event code and Description clears that occurrence.
- Every Event Log record is displayed as one row in the main chronological table, including `On`, `Fail`, and `Pass` states.
- The main table can be sorted by timestamp, record, event, description, state, or mode.
- Its checkbox filter includes every State and Event type, with **Select all** enabled by default.
- All nine used pressure readings are visible directly in that row.
- Failure clearance and duration are attached only to `Fail` rows; other event states remain unchanged.
- Repeated logical rows with the same locomotive, occurrence start second, event code, and state are stored only once.
- **Data Population** includes the complete Event Log and groups by Event code, Description, and State.
- Power Up (`On`), fault activation (`Fail`), and fault clearance (`Pass`) are counted separately.
- Click a populated event row to see every occurrence and its nine pressure readings.
- MRT, BPT, BPalt, ERT, 20TL, 20TT, 10T, BCT, and FLT are converted with `kg/cm² = (raw ÷ 10) × 0.0703069579`.
- Raw A2D, Trgt, and AW4 Press are retained by the source parser but omitted from visible analysis because they are not used; `N/A` pressure values display as `Not Available`.
- The **Understand Algorithm** tab documents every parsing, sorting, pairing, scaling, population, storage, and export rule.

The filtered Event Log Faults, Data Population, and full Event Log tables can be downloaded only as genuine Excel (`.xlsx`) workbooks or PDF documents.
