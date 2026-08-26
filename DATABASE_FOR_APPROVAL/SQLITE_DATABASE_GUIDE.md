# CCB fleet SQLite database

Open `ccb_fleet.sqlite` from the workspace root with any VS Code SQLite extension.
The database is a real SQLite 3 file; it is not a CSV or a simulated browser table.

## Core structure

| Table | Purpose |
|---|---|
| `locomotives` | One master row per locomotive number. |
| `import_runs` | Census and result of each bulk/single import operation. |
| `import_files` | One audit row for every TXT presented to the importer, including duplicate and invalid files. |
| `reports` | Parsed CCB report metadata and software version. |
| `event_occurrences` | Canonical duplicate-protected Event Log identities. |
| `event_log` | Event date/time, code, description, state, mode, and source record. |
| `event_environment` | Nine pressure channels in raw, PSI, and kg/cm2 form; unused raw fields are preserved too. |
| `loading_log` | Software-install history parsed from Loading Log. |
| `stored_fault_log` | Stored Fault Log data, kept separate from Event Log data. |
| `duplicate_rejections` | Exact reason and source line for every rejected duplicate row/file. |
| `import_errors` | Invalid-file and parsing error audit. |

The database applies the requested identity rule with a UNIQUE constraint on:

`locomotive + fault occurrence start second + normalized event code + normalized state`

Fail and Pass rows are paired FIFO by event code and description. The Pass row uses
its matching Fail row's timestamp as its occurrence start, while retaining its own
clear timestamp. Including state in the key preserves one Fail and one Pass row but
rejects repeated copies of either row from merged/re-uploaded files.

Pressure conversion is `raw / 10 = PSI`, then
`PSI * 0.0703069579 = kg/cm2`. Not-available values remain NULL numerically.

## Ready-made views

| View | Use |
|---|---|
| `v_event_timeline` | Full chronological Event Log with environment data. |
| `v_locomotive_summary` | Reports/events/fault counts and first/latest event per locomotive. |
| `v_fault_locomotive_counts` | Long-form fault x locomotive matrix source. |
| `v_fault_totals` | Faults sorted by descending total occurrence. |

Open `VIEW_DATABASE.sql` for ready-to-run inspection queries.

## Rebuild or update

From the workspace terminal:

```powershell
py -3 DATABASE_FOR_APPROVAL\import_ccb_to_sqlite.py
```

The default is incremental and idempotent. To deliberately rebuild only the
selected database file from the reviewed folder and include the supplied sample:

```powershell
py -3 DATABASE_FOR_APPROVAL\import_ccb_to_sqlite.py --rebuild `
  --additional-file "C:\Users\acer\Desktop\37546 13-07-26 .txt"
```

