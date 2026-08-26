(function startApp() {
  "use strict";

  const { PRESSURE_SENSOR_FIELDS, parseEventLog } = window.CCBParser;
  const FleetDatabase = window.CCBDatabase;
  const PRESSURE_SENSOR_KEYS = new Set(PRESSURE_SENSOR_FIELDS.map(([field]) => field));
  const state = {
    report: null,
    faultRows: [],
    populationRows: [],
    eventRows: [],
    loadingLogHistory: [],
    currentLoadingLogEntry: null,
    storedFaultLogHistory: [],
    currentStoredFaultLogEntry: null,
    selectedFaultStates: new Set(),
    selectedFaultEvents: new Set(),
    selectedDatabaseFaults: new Set(),
    databaseFaultOptions: [],
    databaseSortKey: "timestamp",
    databaseSortDirection: "desc",
    selectedMatrixFaults: new Set(),
    matrixFaultOptions: [],
    databaseLocomotives: [],
    databaseEvents: [],
    databaseRows: [],
    fleetFaultMatrix: null,
  };
  const SOFTWARE_HISTORY_KEY = "ccb-analyser-software-version-history-v1";
  const LOADING_LOG_HISTORY_KEY = "ccb-analyser-loading-log-history-v1";
  const STORED_FAULT_LOG_HISTORY_KEY = "ccb-analyser-stored-fault-log-history-v1";
  let importResultTimer = null;
  let resolveImportResult = null;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const elements = {
    fileInput: $("#file-input"),
    folderInput: $("#folder-input"),
    dropZone: $("#drop-zone"),
    folderUpload: $("#folder-upload"),
    optionsTrigger: $("#options-trigger"),
    optionsBackdrop: $("#options-backdrop"),
    optionsDrawer: $("#options-drawer"),
    optionsClose: $("#options-close"),
    drawerUploadFiles: $("#drawer-upload-files"),
    drawerUploadFolder: $("#drawer-upload-folder"),
    viewExistingData: $("#view-existing-data"),
    uploadCard: $("#upload-card"),
    uploadMessage: $("#upload-message"),
    dashboard: $("#dashboard"),
    importResultNotice: $("#import-result-notice"),
    importResultBackdrop: $("#upload-result-backdrop"),
    importResultTitle: $("#import-result-title"),
    importResultDetail: $("#import-result-detail"),
    headerDatabaseButton: $("#header-database-button"),
    headerDatabaseCount: $("#header-database-count"),
    headerViewLocoButton: $("#header-view-loco-button"),
    locoPickerModal: $("#loco-picker-modal"),
    locoPickerSelect: $("#loco-picker-select"),
    locoPickerSummary: $("#loco-picker-summary"),
    locoPickerEmpty: $("#loco-picker-empty"),
    openLocoPageButton: $("#open-loco-page"),
    reportTitle: $("#report-title"),
    reportMeta: $("#report-meta"),
    softwareVersion: $("#software-version"),
    storedVersion: $("#stored-version"),
    storedVersionValue: $("#stored-version-value"),
    loadingLogButton: $("#loading-log-button"),
    loadingLogCount: $("#loading-log-count"),
    headerLoadingLogButton: $("#header-loading-log-button"),
    loadingLogModal: $("#loading-log-modal"),
    loadingLogHistorySelect: $("#loading-log-history-select"),
    loadingLogBody: $("#loading-log-body"),
    loadingLogEmpty: $("#loading-log-empty"),
    storedFaultLogButton: $("#stored-fault-log-button"),
    storedFaultLogCount: $("#stored-fault-log-count"),
    headerStoredFaultButton: $("#header-stored-fault-button"),
    storedFaultLogModal: $("#stored-fault-log-modal"),
    storedFaultHistorySelect: $("#stored-fault-history-select"),
    storedFaultBody: $("#stored-fault-body"),
    storedFaultEmpty: $("#stored-fault-empty"),
    faultSearch: $("#fault-search"),
    faultDateFilter: $("#fault-date-filter"),
    faultSort: $("#fault-sort"),
    faultFilterContainer: $("#fault-check-filter"),
    faultFilterButton: $("#fault-filter-button"),
    faultFilterButtonText: $("#fault-filter-button-text"),
    faultFilterMenu: $("#fault-filter-menu"),
    faultFilterSelectAll: $("#fault-filter-select-all"),
    faultStateOptions: $("#fault-state-options"),
    faultEventOptions: $("#fault-event-options"),
    populationSearch: $("#population-search"),
    populationTableBody: $("#population-table-body"),
    eventSearch: $("#event-search"),
    stateFilter: $("#state-filter"),
    eventDateFilter: $("#event-date-filter"),
    faultLogBody: $("#fault-log-body"),
    eventTableBody: $("#event-table-body"),
    faultEmpty: $("#fault-empty"),
    populationEmpty: $("#population-empty"),
    eventEmpty: $("#event-empty"),
    databaseLocomotiveBody: $("#database-locomotive-body"),
    databaseLocomotiveSelect: $("#database-locomotive-select"),
    databaseStateFilter: $("#database-state-filter"),
    databaseSort: $("#database-sort"),
    databaseFromMonth: $("#database-from-month"),
    databaseToMonth: $("#database-to-month"),
    databaseSearch: $("#database-search"),
    databaseEventBody: $("#database-event-body"),
    databaseEventWrap: $("#database-event-wrap"),
    databaseEmpty: $("#database-empty"),
    databaseFaultFilterButton: $("#database-fault-filter-button"),
    databaseFaultFilterMenu: $("#database-fault-filter-menu"),
    databaseFaultSelectAll: $("#database-fault-select-all"),
    databaseFaultOptions: $("#database-fault-options"),
    fleetAnalysisSummary: $("#fleet-analysis-summary"),
    fleetMatrixWrap: $("#fleet-matrix-wrap"),
    fleetMatrixHead: $("#fleet-matrix-head"),
    fleetMatrixBody: $("#fleet-matrix-body"),
    fleetAnalysisEmpty: $("#fleet-analysis-empty"),
    matrixFaultFilterMenu: $("#matrix-fault-filter-menu"),
    matrixFaultSelectAll: $("#matrix-fault-select-all"),
    matrixFaultOptions: $("#matrix-fault-options"),
    matrixOccurrenceModal: $("#matrix-occurrence-modal"),
    matrixOccurrenceTitle: $("#matrix-occurrence-title"),
    matrixOccurrenceContext: $("#matrix-occurrence-context"),
    matrixOccurrenceBody: $("#matrix-occurrence-body"),
    matrixOccurrenceEmpty: $("#matrix-occurrence-empty"),
    matrixOccurrenceSummary: $("#matrix-occurrence-summary"),
    statisticsLocomotives: $("#statistics-locomotives"),
    statisticsReports: $("#statistics-reports"),
    statisticsEvents: $("#statistics-events"),
    statisticsFaults: $("#statistics-faults"),
    statisticsCleared: $("#statistics-cleared"),
    statisticsUnresolved: $("#statistics-unresolved"),
    statisticsClearanceRate: $("#statistics-clearance-rate"),
    statisticsPeriod: $("#statistics-period"),
  };

  const dateFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const monthYearFormatter = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
  });

  function monthStart(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, 1).getTime();
  }

  function monthAfter(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]), 1).getTime();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showImportResult(kind, title, detail) {
    if (importResultTimer) clearTimeout(importResultTimer);
    elements.importResultNotice.className = `import-result-notice is-${kind}`;
    elements.importResultTitle.textContent = title;
    elements.importResultDetail.textContent = detail;
    elements.importResultBackdrop.hidden = false;
    return new Promise((resolve) => {
      resolveImportResult = resolve;
      importResultTimer = setTimeout(hideImportResult, 2000);
    });
  }

  function hideImportResult() {
    if (importResultTimer) clearTimeout(importResultTimer);
    importResultTimer = null;
    elements.importResultBackdrop.hidden = true;
    const resolve = resolveImportResult;
    resolveImportResult = null;
    if (resolve) resolve();
  }

  function formatDuration(milliseconds) {
    if (milliseconds === null || milliseconds === undefined) return "Not cleared";
    const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (seconds || !parts.length) parts.push(`${seconds}s`);
    return parts.join(" ");
  }

  function sensorDisplay(event, field) {
    if (!PRESSURE_SENSOR_KEYS.has(field)) return event[field];
    return event.pressureValues?.[field]?.display ?? "Not Available";
  }

  function sensorTitle(event, field) {
    if (!PRESSURE_SENSOR_KEYS.has(field)) return `Source value: ${event[field]}`;
    const scaled = event.pressureValues?.[field];
    if (!scaled || scaled.kgCm2 === null) return `Source value: ${event[field]} — Not Available`;
    return `Source ${scaled.raw} → ${scaled.psi.toFixed(1)} PSI → ${scaled.display} kg/cm²`;
  }

  function stateClass(value) {
    const normalized = String(value).toLocaleLowerCase();
    if (normalized === "fail") return "badge-fail";
    if (normalized === "pass") return "badge-pass";
    return "badge-neutral";
  }

  function option(value, label) {
    const node = document.createElement("option");
    node.value = value;
    node.textContent = label;
    return node;
  }

  function setSelectOptions(select, items, firstLabel) {
    select.replaceChildren(option("all", firstLabel));
    for (const item of items) select.append(option(item.value, item.label));
  }

  function showStoredSoftwareVersion(entry) {
    if (!entry || !entry.softwareVersion) return;
    elements.storedVersionValue.textContent = entry.softwareVersion;
    elements.storedVersion.hidden = false;
    const details = [entry.fileName, entry.locomotiveNumber ? `Locomotive ${entry.locomotiveNumber}` : "", entry.savedAt]
      .filter(Boolean)
      .join(" · ");
    elements.storedVersion.title = details;
  }

  function restoreStoredSoftwareVersion() {
    try {
      const history = JSON.parse(localStorage.getItem(SOFTWARE_HISTORY_KEY) || "[]");
      if (Array.isArray(history) && history.length) showStoredSoftwareVersion(history[0]);
    } catch (_) {
      // The analyser still works when browser storage is unavailable.
    }
  }

  function saveSoftwareVersion(report) {
    if (!report.softwareVersion || report.softwareVersion === "Unknown") return;
    const entry = {
      softwareVersion: report.softwareVersion,
      fileName: report.fileName,
      locomotiveNumber: report.locomotiveNumber,
      savedAt: new Date().toISOString(),
    };
    try {
      const stored = JSON.parse(localStorage.getItem(SOFTWARE_HISTORY_KEY) || "[]");
      const history = Array.isArray(stored) ? stored : [];
      const remaining = history.filter((item) =>
        !(item.softwareVersion === entry.softwareVersion && item.fileName === entry.fileName),
      );
      localStorage.setItem(SOFTWARE_HISTORY_KEY, JSON.stringify([entry, ...remaining].slice(0, 100)));
      showStoredSoftwareVersion(entry);
    } catch (_) {
      // Ignore storage failures without preventing analysis.
    }
  }

  function loadingLogEntryKey(entry) {
    return `${entry.softwareVersion}\u241f${entry.fileName}\u241f${entry.locomotiveNumber || ""}`;
  }

  function createLoadingLogEntry(report) {
    return {
      softwareVersion: report.softwareVersion || report.reportId || "Unknown",
      fileName: report.fileName,
      locomotiveNumber: report.locomotiveNumber,
      savedAt: new Date().toISOString(),
      records: (report.loadingLog || []).map((record) => ({
        number: record.number,
        dateRaw: record.dateRaw,
        timeRaw: record.timeRaw,
        userId: record.userId,
        fileName: record.fileName,
        softwareVersion: record.softwareVersion,
        timestampMs: record.timestampMs,
      })),
    };
  }

  function updateLoadingLogControls() {
    const currentCount = state.currentLoadingLogEntry?.records?.length || 0;
    elements.loadingLogCount.textContent = currentCount;
    elements.loadingLogButton.classList.toggle("has-records", currentCount > 0);
    elements.headerLoadingLogButton.hidden = state.loadingLogHistory.length === 0;
  }

  function restoreStoredLoadingLogs() {
    try {
      const history = JSON.parse(localStorage.getItem(LOADING_LOG_HISTORY_KEY) || "[]");
      state.loadingLogHistory = Array.isArray(history) ? history : [];
    } catch (_) {
      state.loadingLogHistory = [];
    }
    updateLoadingLogControls();
  }

  function saveLoadingLog(report) {
    const entry = createLoadingLogEntry(report);
    state.currentLoadingLogEntry = entry;
    if (entry.records.length) {
      const key = loadingLogEntryKey(entry);
      const remaining = state.loadingLogHistory.filter((item) => loadingLogEntryKey(item) !== key);
      state.loadingLogHistory = [entry, ...remaining].slice(0, 50);
      try {
        localStorage.setItem(LOADING_LOG_HISTORY_KEY, JSON.stringify(state.loadingLogHistory));
      } catch (_) {
        // Keep the history for this session when persistent storage is unavailable.
      }
    }
    updateLoadingLogControls();
  }

  function availableLoadingLogs() {
    const entries = [...state.loadingLogHistory];
    if (state.currentLoadingLogEntry) {
      const currentKey = loadingLogEntryKey(state.currentLoadingLogEntry);
      if (!entries.some((entry) => loadingLogEntryKey(entry) === currentKey)) entries.unshift(state.currentLoadingLogEntry);
    }
    return entries;
  }

  function renderLoadingLogEntry(entry) {
    const records = entry?.records || [];
    elements.loadingLogBody.innerHTML = records.map((record, index) => `<tr>
      <td class="cell-mono">${escapeHtml(record.number || index + 1)}</td>
      <td class="nowrap cell-strong">${escapeHtml(record.dateRaw)}</td>
      <td class="nowrap cell-strong">${escapeHtml(record.timeRaw)}</td>
      <td class="cell-mono">${escapeHtml(record.userId)}</td>
      <td class="filename-cell">${escapeHtml(record.fileName)}</td>
      <td><span class="version-chip">${escapeHtml(record.softwareVersion)}</span></td>
    </tr>`).join("");
    $("#modal-software-version").textContent = entry?.softwareVersion || "Not available";
    $("#loading-log-context").textContent = entry
      ? [entry.fileName, entry.locomotiveNumber ? `Locomotive ${entry.locomotiveNumber}` : "", entry.savedAt ? `Saved ${dateTimeFormatter.format(new Date(entry.savedAt))}` : ""].filter(Boolean).join(" · ")
      : "No saved report selected";
    $("#loading-log-record-summary").textContent = `${records.length} installed software version${records.length === 1 ? "" : "s"}`;
    elements.loadingLogEmpty.hidden = records.length !== 0;
    $("#loading-log-table-wrap").hidden = records.length === 0;
  }

  function openLoadingLog(useSavedHistory = false) {
    const entries = availableLoadingLogs();
    elements.loadingLogHistorySelect.replaceChildren();
    entries.forEach((entry, index) => {
      const label = `${entry.softwareVersion} — ${entry.fileName}${entry.records.length ? ` (${entry.records.length})` : " (no records)"}`;
      elements.loadingLogHistorySelect.append(option(String(index), label));
    });
    elements.loadingLogHistorySelect.disabled = entries.length <= 1;
    const selectedIndex = useSavedHistory && state.loadingLogHistory.length && state.currentLoadingLogEntry && !state.currentLoadingLogEntry.records.length
      ? Math.max(0, entries.findIndex((entry) => entry.records.length))
      : 0;
    elements.loadingLogHistorySelect.value = String(selectedIndex);
    renderLoadingLogEntry(entries[selectedIndex]);
    elements.loadingLogModal.hidden = false;
    document.body.classList.add("modal-open");
    $("#close-loading-log").focus();
  }

  function closeLoadingLog() {
    elements.loadingLogModal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  function storedFaultEntryKey(entry) {
    return `${entry.softwareVersion}\u241f${entry.fileName}\u241f${entry.locomotiveNumber || ""}`;
  }

  function createStoredFaultLogEntry(report) {
    return {
      softwareVersion: report.softwareVersion || report.reportId || "Unknown",
      fileName: report.fileName,
      locomotiveNumber: report.locomotiveNumber,
      savedAt: new Date().toISOString(),
      records: (report.storedFaultLog || []).map((record) => ({
        currentStatus: record.currentStatus,
        failureCount: record.failureCount,
        timeLastFailedRaw: record.timeLastFailedRaw,
        timeLastClearedRaw: record.timeLastClearedRaw,
        timeLastFailedMs: record.timeLastFailedMs,
        timeLastClearedMs: record.timeLastClearedMs,
        faultCode: record.faultCode,
        description: record.description,
      })),
    };
  }

  function updateStoredFaultLogControls() {
    const currentCount = state.currentStoredFaultLogEntry?.records?.length || 0;
    elements.storedFaultLogCount.textContent = currentCount;
    elements.storedFaultLogButton.classList.toggle("has-records", currentCount > 0);
    elements.headerStoredFaultButton.hidden = state.storedFaultLogHistory.length === 0;
  }

  function restoreStoredFaultLogs() {
    try {
      const history = JSON.parse(localStorage.getItem(STORED_FAULT_LOG_HISTORY_KEY) || "[]");
      state.storedFaultLogHistory = Array.isArray(history) ? history : [];
    } catch (_) {
      state.storedFaultLogHistory = [];
    }
    updateStoredFaultLogControls();
  }

  function saveStoredFaultLog(report) {
    const entry = createStoredFaultLogEntry(report);
    state.currentStoredFaultLogEntry = entry;
    if (entry.records.length) {
      const key = storedFaultEntryKey(entry);
      const remaining = state.storedFaultLogHistory.filter((item) => storedFaultEntryKey(item) !== key);
      state.storedFaultLogHistory = [entry, ...remaining].slice(0, 50);
      try {
        localStorage.setItem(STORED_FAULT_LOG_HISTORY_KEY, JSON.stringify(state.storedFaultLogHistory));
      } catch (_) {
        // Keep the parsed table available for the current session.
      }
    }
    updateStoredFaultLogControls();
  }

  function availableStoredFaultLogs() {
    const entries = [...state.storedFaultLogHistory];
    if (state.currentStoredFaultLogEntry) {
      const currentKey = storedFaultEntryKey(state.currentStoredFaultLogEntry);
      if (!entries.some((entry) => storedFaultEntryKey(entry) === currentKey)) entries.unshift(state.currentStoredFaultLogEntry);
    }
    return entries;
  }

  function storedFaultTimestamp(rawValue, timestampMs) {
    const formatted = timestampMs === null || timestampMs === undefined
      ? "Not recorded"
      : dateTimeFormatter.format(new Date(timestampMs));
    return `<span class="stored-timestamp"><strong>${escapeHtml(formatted)}</strong><small>${escapeHtml(rawValue)}</small></span>`;
  }

  function renderStoredFaultLogEntry(entry) {
    const records = entry?.records || [];
    elements.storedFaultBody.innerHTML = records.map((record, index) => `<tr>
      <td class="cell-mono">${index + 1}</td>
      <td><span class="status-badge ${stateClass(record.currentStatus)}">${escapeHtml(record.currentStatus)}</span></td>
      <td><strong class="failure-count-value">${Number(record.failureCount).toLocaleString("en-IN")}</strong></td>
      <td>${storedFaultTimestamp(record.timeLastFailedRaw, record.timeLastFailedMs)}</td>
      <td>${storedFaultTimestamp(record.timeLastClearedRaw, record.timeLastClearedMs)}</td>
      <td>${record.faultCode ? `<span class="code-chip">${escapeHtml(record.faultCode)}</span>` : "—"}</td>
      <td class="description-cell">${escapeHtml(record.description)}</td>
    </tr>`).join("");
    $("#stored-fault-modal-version").textContent = entry?.softwareVersion || "Not available";
    $("#stored-fault-context").textContent = entry
      ? [entry.fileName, entry.locomotiveNumber ? `Locomotive ${entry.locomotiveNumber}` : "", entry.savedAt ? `Saved ${dateTimeFormatter.format(new Date(entry.savedAt))}` : ""].filter(Boolean).join(" · ")
      : "No saved report selected";
    const cumulativeFailures = records.reduce((total, record) => total + (Number(record.failureCount) || 0), 0);
    $("#stored-fault-record-summary").textContent = `${records.length} stored fault type${records.length === 1 ? "" : "s"} · ${cumulativeFailures.toLocaleString("en-IN")} cumulative failures`;
    elements.storedFaultEmpty.hidden = records.length !== 0;
    $("#stored-fault-table-wrap").hidden = records.length === 0;
  }

  function openStoredFaultLog(useSavedHistory = false) {
    const entries = availableStoredFaultLogs();
    elements.storedFaultHistorySelect.replaceChildren();
    entries.forEach((entry, index) => {
      const label = `${entry.softwareVersion} — ${entry.fileName}${entry.records.length ? ` (${entry.records.length})` : " (no records)"}`;
      elements.storedFaultHistorySelect.append(option(String(index), label));
    });
    elements.storedFaultHistorySelect.disabled = entries.length <= 1;
    const selectedIndex = useSavedHistory && state.storedFaultLogHistory.length && state.currentStoredFaultLogEntry && !state.currentStoredFaultLogEntry.records.length
      ? Math.max(0, entries.findIndex((entry) => entry.records.length))
      : 0;
    elements.storedFaultHistorySelect.value = String(selectedIndex);
    renderStoredFaultLogEntry(entries[selectedIndex]);
    elements.storedFaultLogModal.hidden = false;
    document.body.classList.add("modal-open");
    $("#close-stored-fault-log").focus();
  }

  function closeStoredFaultLog() {
    elements.storedFaultLogModal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  function setupFieldMap() {
    const descriptions = {
      MRT: "Main Reservoir Transducer (located in BPCP) · kg/cm²",
      BPT: "Brake Pipe Transducer (located in BPCP) · kg/cm²",
      BPalt: "Train-line Brake Pipe Transducer (located in ERCP) · kg/cm²",
      ERT: "Equalising Reservoir Transducer (located in ERCP) · kg/cm²",
      "20TL": "20 Train Line (located in 20CP) · kg/cm²",
      "20TT": "20 Pipe Transducer (located in 20CP) · kg/cm²",
      "10T": "10 Pipe Transducer (located in ERCP) · kg/cm²",
      BCT: "Brake Cylinder Transducer (located in ERCP) · kg/cm²",
      FLT: "Flow Transducer (located in BPCP) · kg/cm²",
      "Raw A2D": "Additional source data; no pressure conversion",
      Trgt: "Additional source data; no pressure conversion",
      "AW4 Press": "Target-handle movement data; no pressure conversion",
    };
    $("#field-map-grid").innerHTML = PRESSURE_SENSOR_FIELDS.map(
      ([, label]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(descriptions[label])}</span></div>`,
    ).join("");
  }

  function faultEventKey(event) {
    return `${event.eventCode}\u241f${event.description}`;
  }

  function updateFaultFilterControl() {
    const optionCheckboxes = $$(".fault-option-checkbox");
    const selectedCount = optionCheckboxes.filter((checkbox) => checkbox.checked).length;
    const totalCount = optionCheckboxes.length;
    const allSelected = totalCount > 0 && selectedCount === totalCount;
    elements.faultFilterSelectAll.checked = allSelected;
    elements.faultFilterSelectAll.indeterminate = selectedCount > 0 && !allSelected;
    elements.faultFilterButtonText.textContent = allSelected ? "Select all" : `${selectedCount} of ${totalCount}`;
    elements.faultFilterButton.classList.toggle("has-filter", !allSelected);
  }

  function populateFaultChecklist(report) {
    const stateNames = [...new Set(report.events.map((event) => event.state))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const eventTypes = [...new Map(report.events.map((event) => [faultEventKey(event), event])).values()]
      .sort((a, b) =>
        a.eventCode.localeCompare(b.eventCode, undefined, { numeric: true }) ||
        a.description.localeCompare(b.description),
      );

    state.selectedFaultStates = new Set(stateNames.map((value) => value.toLocaleLowerCase()));
    state.selectedFaultEvents = new Set(eventTypes.map(faultEventKey));
    elements.faultStateOptions.innerHTML = stateNames.map((value) => `<label class="check-filter-option">
      <input class="fault-option-checkbox" type="checkbox" data-filter-group="state" data-filter-value="${escapeHtml(value.toLocaleLowerCase())}" checked />
      <span><strong>${escapeHtml(value)}</strong></span>
    </label>`).join("");
    elements.faultEventOptions.innerHTML = eventTypes.map((event) => `<label class="check-filter-option">
      <input class="fault-option-checkbox" type="checkbox" data-filter-group="event" data-filter-value="${escapeHtml(faultEventKey(event))}" checked />
      <span><strong>${escapeHtml(event.eventCode)}</strong><small>${escapeHtml(event.description)}</small></span>
    </label>`).join("");
    updateFaultFilterControl();
  }

  function compareFaultEvents(left, right) {
    const [field, direction] = elements.faultSort.value.split(":");
    const multiplier = direction === "desc" ? -1 : 1;
    let comparison = 0;
    if (field === "timestamp") comparison = left.timestampMs - right.timestampMs;
    else if (field === "record") comparison = (Number(left.record) || 0) - (Number(right.record) || 0);
    else if (field === "event") comparison = left.eventCode.localeCompare(right.eventCode, undefined, { numeric: true });
    else if (field === "description") comparison = left.description.localeCompare(right.description);
    else if (field === "state") comparison = left.state.localeCompare(right.state);
    else if (field === "mode") comparison = left.mode.localeCompare(right.mode);
    return comparison * multiplier || left.timestampMs - right.timestampMs || left.originalIndex - right.originalIndex;
  }

  function getFaultRows() {
    if (!state.report) return [];
    const query = elements.faultSearch.value.trim().toLocaleLowerCase();
    const dateKey = elements.faultDateFilter.value;
    const episodesByFailure = new Map(
      state.report.faultEpisodes.map((episode) => [episode.failedEvent.originalIndex, episode]),
    );
    return state.report.events
      .filter((event) => {
        const matchesDate = dateKey === "all" || event.dateKey === dateKey;
        const matchesState = state.selectedFaultStates.has(event.state.toLocaleLowerCase());
        const matchesEvent = state.selectedFaultEvents.has(faultEventKey(event));
        const haystack = `${event.record} ${event.eventCode} ${event.description} ${event.mode} ${event.state}`.toLocaleLowerCase();
        return matchesDate && matchesState && matchesEvent && (!query || haystack.includes(query));
      })
      .sort(compareFaultEvents)
      .map((event) => ({ event, episode: episodesByFailure.get(event.originalIndex) || null }));
  }

  function renderFaults() {
    const rows = getFaultRows();
    state.faultRows = rows;
    elements.faultLogBody.innerHTML = rows.map(({ event, episode }, index) => {
      const isFailure = event.state.toLocaleLowerCase() === "fail";
      const clearedAt = isFailure && episode?.clearedEvent
        ? dateTimeFormatter.format(episode.clearedEvent.date)
        : "—";
      const duration = isFailure ? formatDuration(episode?.durationMs ?? null) : "—";
      return `<tr>
        <td class="cell-mono">${index + 1}</td>
        <td class="nowrap cell-strong">${escapeHtml(dateFormatter.format(event.date))}</td>
        <td class="nowrap cell-strong">${escapeHtml(timeFormatter.format(event.date))}</td>
        <td><span class="code-chip">${escapeHtml(event.eventCode)}</span></td>
        <td class="description-cell">${escapeHtml(event.description)}</td>
        <td><span class="status-badge ${stateClass(event.state)}">${escapeHtml(event.state)}</span></td>
        <td class="clearance-cell">${escapeHtml(clearedAt)}</td>
        <td class="nowrap">${escapeHtml(duration)}</td>
        <td class="nowrap">${escapeHtml(event.mode)}</td>
        <td class="cell-mono">${escapeHtml(event.record)}</td>
        ${PRESSURE_SENSOR_FIELDS.map(([field]) => `<td class="cell-number" title="${escapeHtml(sensorTitle(event, field))}">${escapeHtml(sensorDisplay(event, field))}</td>`).join("")}
      </tr>`;
    }).join("");
    elements.faultEmpty.hidden = rows.length !== 0;
    $("#fault-log-wrap").hidden = rows.length === 0;
    const chronologicalRows = [...rows].sort((left, right) => left.event.timestampMs - right.event.timestampMs);
    const range = chronologicalRows.length
      ? ` Date range: ${dateTimeFormatter.format(chronologicalRows[0].event.date)} to ${dateTimeFormatter.format(chronologicalRows[chronologicalRows.length - 1].event.date)}.`
      : "";
    const sortLabel = elements.faultSort.selectedOptions[0]?.textContent || "Selected order";
    $("#fault-result-note").textContent = `Showing ${rows.length} of ${state.report.events.length} Event Log record${rows.length === 1 ? "" : "s"} · Sorted: ${sortLabel}.${range}`;
  }

  function buildPopulationGroups(report) {
    const groups = new Map();
    const faultEpisodes = new Map(
      report.faultEpisodes.map((episode) => [episode.failedEvent.originalIndex, episode]),
    );
    for (const event of report.events) {
      const occurrence = faultEpisodes.get(event.originalIndex) || {
        failedEvent: event,
        clearedEvent: null,
        durationMs: null,
        status: event.state,
      };
      const key = `${event.eventCode}\u241f${event.description.toLocaleLowerCase()}\u241f${event.state.toLocaleLowerCase()}`;
      if (!groups.has(key)) {
        groups.set(key, {
          eventCode: event.eventCode,
          description: event.description,
          state: event.state,
          occurrences: [],
        });
      }
      groups.get(key).occurrences.push(occurrence);
    }

    return [...groups.values()]
      .map((group) => ({
        ...group,
        eventDates: new Set(group.occurrences.map((occurrence) => occurrence.failedEvent.dateKey)).size,
        cleared: group.state.toLocaleLowerCase() === "fail"
          ? group.occurrences.filter((occurrence) => occurrence.clearedEvent).length
          : null,
        first: group.occurrences[0].failedEvent,
        last: group.occurrences[group.occurrences.length - 1].failedEvent,
      }))
      .sort((a, b) =>
        b.occurrences.length - a.occurrences.length ||
        a.eventCode.localeCompare(b.eventCode, undefined, { numeric: true }) ||
        a.state.localeCompare(b.state),
      );
  }

  function getPopulationRows() {
    if (!state.report) return [];
    const query = elements.populationSearch.value.trim().toLocaleLowerCase();
    return buildPopulationGroups(state.report).filter((group) => {
      const haystack = `${group.eventCode} ${group.description} ${group.state}`.toLocaleLowerCase();
      return !query || haystack.includes(query);
    });
  }

  function renderPopulation() {
    const groups = getPopulationRows();
    state.populationRows = groups;
    elements.populationTableBody.replaceChildren();

    groups.forEach((group, index) => {
      const isFailure = group.state.toLocaleLowerCase() === "fail";
      const unresolved = isFailure ? group.occurrences.length - group.cleared : null;
      const summaryRow = document.createElement("tr");
      summaryRow.className = "population-row";
      summaryRow.tabIndex = 0;
      summaryRow.setAttribute("aria-expanded", "false");
      summaryRow.innerHTML = `
        <td><span class="expand-indicator" aria-hidden="true">›</span></td>
        <td class="rank-cell">${index + 1}</td>
        <td><span class="code-chip">${escapeHtml(group.eventCode)}</span></td>
        <td class="description-cell">${escapeHtml(group.description)}</td>
        <td><span class="status-badge ${stateClass(group.state)}">${escapeHtml(group.state)}</span></td>
        <td><strong class="occurrence-count">${group.occurrences.length}</strong></td>
        <td>${group.eventDates}</td>
        <td>${isFailure ? `<span class="status-badge badge-pass">${group.cleared}</span>` : "—"}</td>
        <td>${isFailure ? `<span class="status-badge ${unresolved ? "badge-fail" : "badge-neutral"}">${unresolved}</span>` : "—"}</td>
        <td class="nowrap">${escapeHtml(dateTimeFormatter.format(group.first.date))}</td>
        <td class="nowrap">${escapeHtml(dateTimeFormatter.format(group.last.date))}</td>`;

      const detailRow = document.createElement("tr");
      detailRow.className = "population-detail-row";
      detailRow.hidden = true;
      const detailCell = document.createElement("td");
      detailCell.colSpan = 11;
      detailCell.innerHTML = `
        <div class="population-detail">
          <div class="population-detail-heading">
            <div><strong>Occurrence history and environment data</strong><span>Readings captured on each ${escapeHtml(group.state)} Event Log occurrence</span></div>
            <span>${group.occurrences.length} occurrence${group.occurrences.length === 1 ? "" : "s"}</span>
          </div>
          <div class="table-scroll">
            <table class="data-table environment-table">
              <thead><tr><th>No.</th><th>Occurred at</th><th>State</th><th>Matching clearance</th><th>Duration</th><th>Record</th><th>Mode</th>${PRESSURE_SENSOR_FIELDS.map(([, label]) => `<th>${escapeHtml(label)}<small>kg/cm²</small></th>`).join("")}</tr></thead>
              <tbody>${group.occurrences.map((episode, occurrenceIndex) => {
                const event = episode.failedEvent;
                return `<tr><td>${occurrenceIndex + 1}</td><td class="nowrap cell-strong">${escapeHtml(dateTimeFormatter.format(event.date))}</td><td><span class="status-badge ${stateClass(event.state)}">${escapeHtml(event.state)}</span></td><td class="nowrap">${episode.clearedEvent ? escapeHtml(dateTimeFormatter.format(episode.clearedEvent.date)) : "—"}</td><td>${isFailure ? escapeHtml(formatDuration(episode.durationMs)) : "—"}</td><td class="cell-mono">${escapeHtml(event.record)}</td><td class="nowrap">${escapeHtml(event.mode)}</td>${PRESSURE_SENSOR_FIELDS.map(([field]) => `<td class="cell-number" title="${escapeHtml(sensorTitle(event, field))}">${escapeHtml(sensorDisplay(event, field))}</td>`).join("")}</tr>`;
              }).join("")}</tbody>
            </table>
          </div>
        </div>`;
      detailRow.append(detailCell);

      const toggle = () => {
        const willOpen = detailRow.hidden;
        detailRow.hidden = !willOpen;
        summaryRow.classList.toggle("is-expanded", willOpen);
        summaryRow.setAttribute("aria-expanded", String(willOpen));
      };
      summaryRow.addEventListener("click", toggle);
      summaryRow.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      });
      elements.populationTableBody.append(summaryRow, detailRow);
    });

    const occurrences = groups.reduce((total, group) => total + group.occurrences.length, 0);
    elements.populationEmpty.hidden = groups.length !== 0;
    $("#population-table-wrap").hidden = groups.length === 0;
    $("#population-result-note").textContent = `${groups.length} Event/State group${groups.length === 1 ? "" : "s"}, ranked by ${occurrences} total Event Log occurrence${occurrences === 1 ? "" : "s"}.`;
  }

  function getEventRows() {
    if (!state.report) return [];
    const query = elements.eventSearch.value.trim().toLocaleLowerCase();
    const selectedState = elements.stateFilter.value.toLocaleLowerCase();
    const dateKey = elements.eventDateFilter.value;
    return state.report.events.filter((event) => {
      const matchesState = selectedState === "all" || event.state.toLocaleLowerCase() === selectedState;
      const matchesDate = dateKey === "all" || event.dateKey === dateKey;
      const haystack = `${event.record} ${event.eventCode} ${event.description} ${event.mode} ${event.state}`.toLocaleLowerCase();
      return matchesState && matchesDate && (!query || haystack.includes(query));
    });
  }

  function renderEvents() {
    const events = getEventRows();
    state.eventRows = events;
    elements.eventTableBody.innerHTML = events
      .map(
        (event) => `<tr>
          <td class="cell-mono">${escapeHtml(event.record)}</td>
          ${PRESSURE_SENSOR_FIELDS.map(([field]) => `<td class="cell-number" title="${escapeHtml(sensorTitle(event, field))}">${escapeHtml(sensorDisplay(event, field))}</td>`).join("")}
          <td>${escapeHtml(event.mode)}</td>
          <td><span class="status-badge ${stateClass(event.state)}">${escapeHtml(event.state)}</span></td>
          <td><span class="timestamp-cell"><span>${escapeHtml(dateFormatter.format(event.date))}</span><strong>${escapeHtml(timeFormatter.format(event.date))}</strong></span></td>
          <td><span class="code-chip">${escapeHtml(event.eventCode)}</span></td>
          <td class="description-cell">${escapeHtml(event.description)}</td>
        </tr>`,
      )
      .join("");
    elements.eventEmpty.hidden = events.length !== 0;
    elements.eventTableBody.closest(".table-scroll").hidden = events.length === 0;
    $("#event-result-note").textContent = `Showing ${events.length} of ${state.report.events.length} Event Log records in chronological order.`;
  }

  function updateLocoPickerSummary() {
    const selected = state.databaseLocomotives.find((item) => item.locomotiveNumber === elements.locoPickerSelect.value);
    elements.openLocoPageButton.disabled = !selected;
    if (!selected) {
      elements.locoPickerSummary.innerHTML = "<span>Select a locomotive to see its stored-data summary.</span>";
      return;
    }
    elements.locoPickerSummary.innerHTML = `
      <div><span>Locomotive</span><strong>${escapeHtml(selected.locomotiveNumber)}</strong></div>
      <div><span>Reports</span><strong>${selected.reportCount.toLocaleString("en-IN")}</strong></div>
      <div><span>Events</span><strong>${selected.eventCount.toLocaleString("en-IN")}</strong></div>
      <div><span>Failures</span><strong>${selected.faultCount.toLocaleString("en-IN")}</strong></div>
      <p>${escapeHtml(monthYearFormatter.format(new Date(selected.firstTimestampMs)))} to ${escapeHtml(monthYearFormatter.format(new Date(selected.lastTimestampMs)))}</p>`;
  }

  async function openLocoPicker() {
    state.databaseLocomotives = await FleetDatabase.getLocomotives();
    elements.locoPickerSelect.replaceChildren();
    state.databaseLocomotives.forEach((locomotive) => {
      elements.locoPickerSelect.append(option(locomotive.locomotiveNumber, `Locomotive ${locomotive.locomotiveNumber}`));
    });
    const hasData = state.databaseLocomotives.length > 0;
    if (!hasData) elements.locoPickerSelect.append(option("", "No stored locomotives"));
    $(".loco-picker-body").hidden = !hasData;
    elements.locoPickerEmpty.hidden = hasData;
    updateLocoPickerSummary();
    elements.locoPickerModal.hidden = false;
    document.body.classList.add("modal-open");
    if (hasData) elements.locoPickerSelect.focus();
    else $("#close-loco-picker").focus();
  }

  function closeLocoPicker() {
    elements.locoPickerModal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  function openLocomotiveDataPage(locomotiveNumber) {
    if (!locomotiveNumber) return;
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("view", "locomotive");
    url.searchParams.set("locomotive", locomotiveNumber);
    window.open(url.href, "_blank", "noopener");
  }

  function openSelectedLocoPage() {
    const locomotiveNumber = elements.locoPickerSelect.value;
    if (!locomotiveNumber) return;
    openLocomotiveDataPage(locomotiveNumber);
    closeLocoPicker();
  }

  function setMetricLabels(databaseMode) {
    const metricFaults = $("#metric-faults").closest("article");
    const metricDates = $("#metric-dates").closest("article");
    const metricCleared = $("#metric-cleared").closest("article");
    const metricEvents = $("#metric-events").closest("article");
    metricFaults.querySelector("span").textContent = "Fault activations";
    metricFaults.querySelector("small").textContent = databaseMode ? "Across stored fleet reports" : "Event rows marked Fail";
    metricDates.querySelector("span").textContent = databaseMode ? "Locomotives" : "Fault dates";
    metricDates.querySelector("small").textContent = databaseMode ? "Primary fleet records" : "Dates containing a failure";
    metricCleared.querySelector("span").textContent = databaseMode ? "Stored reports" : "Cleared faults";
    metricEvents.querySelector("span").textContent = "Event records";
  }

  function renderDatabaseSummaryRows() {
    elements.databaseLocomotiveBody.innerHTML = state.databaseLocomotives.map((locomotive) => `<tr class="database-locomotive-row" data-locomotive="${escapeHtml(locomotive.locomotiveNumber)}" tabindex="0">
      <td><span class="locomotive-chip">${escapeHtml(locomotive.locomotiveNumber)}</span></td>
      <td class="cell-number">${locomotive.reportCount.toLocaleString("en-IN")}</td>
      <td class="cell-number">${locomotive.eventCount.toLocaleString("en-IN")}</td>
      <td><strong class="database-fault-count">${locomotive.faultCount.toLocaleString("en-IN")}</strong></td>
      <td class="nowrap">${escapeHtml(dateTimeFormatter.format(new Date(locomotive.firstTimestampMs)))}</td>
      <td class="nowrap">${escapeHtml(dateTimeFormatter.format(new Date(locomotive.lastTimestampMs)))}</td>
      <td class="database-versions">${locomotive.softwareVersions.map((version) => `<span>${escapeHtml(version)}</span>`).join("")}</td>
      <td><button class="database-view-button" type="button" data-locomotive="${escapeHtml(locomotive.locomotiveNumber)}">View</button></td>
    </tr>`).join("");
  }

  function databaseFaultIdentity(event) {
    return `${String(event.eventCode || "").trim().toLocaleUpperCase()}\u241f${String(event.description || "").trim().toLocaleLowerCase()}`;
  }

  function updateDatabaseFaultFilterControl() {
    const total = state.databaseFaultOptions.length;
    const selected = state.selectedDatabaseFaults.size;
    elements.databaseFaultSelectAll.checked = total > 0 && selected === total;
    elements.databaseFaultSelectAll.indeterminate = selected > 0 && selected < total;
    elements.databaseFaultFilterButton.classList.toggle("has-filter", selected < total);
    elements.databaseFaultFilterButton.title = selected === total
      ? `All ${total.toLocaleString("en-IN")} event / fault types selected`
      : `${selected.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} event / fault types selected`;
  }

  function populateDatabaseFaultFilter(events) {
    const unique = new Map();
    events.forEach((event) => {
      const identity = databaseFaultIdentity(event);
      if (!unique.has(identity)) unique.set(identity, {
        identity,
        eventCode: String(event.eventCode || ""),
        description: String(event.description || "Unknown event"),
      });
    });
    state.databaseFaultOptions = [...unique.values()].sort((left, right) =>
      left.eventCode.localeCompare(right.eventCode, undefined, { numeric: true })
      || left.description.localeCompare(right.description));
    state.selectedDatabaseFaults = new Set(state.databaseFaultOptions.map((item) => item.identity));
    elements.databaseFaultOptions.innerHTML = state.databaseFaultOptions.map((item) => `<label class="check-filter-option">
      <input class="database-fault-option" type="checkbox" data-fault-identity="${escapeHtml(item.identity)}" checked />
      <span><strong>Event ${escapeHtml(item.eventCode)}</strong><small>${escapeHtml(item.description)}</small></span>
    </label>`).join("");
    updateDatabaseFaultFilterControl();
  }

  function databaseSortValue(event, key) {
    if (key === "serial") return Number(event.originalIndex);
    if (key === "timestamp") return Number(event.timestampMs);
    if (key === "event") return String(event.eventCode || "");
    if (key === "description") return String(event.description || "");
    if (key === "state") return String(event.state || "");
    if (key === "cleared") return event.clearedAtMs;
    if (key === "duration") return event.durationMs;
    if (key === "mode") return String(event.mode || "");
    if (key === "record") return Number(event.record);
    if (PRESSURE_SENSOR_KEYS.has(key)) return event.pressureValues?.[key]?.kgCm2 ?? null;
    return Number(event.timestampMs);
  }

  function compareDatabaseEvents(left, right) {
    const leftValue = databaseSortValue(left, state.databaseSortKey);
    const rightValue = databaseSortValue(right, state.databaseSortKey);
    if (leftValue === null || leftValue === undefined) return rightValue === null || rightValue === undefined ? 0 : 1;
    if (rightValue === null || rightValue === undefined) return -1;
    let comparison;
    if (typeof leftValue === "number" && typeof rightValue === "number") comparison = leftValue - rightValue;
    else comparison = String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" });
    const direction = state.databaseSortDirection === "desc" ? -1 : 1;
    return comparison * direction || left.originalIndex - right.originalIndex;
  }

  function renderDatabaseSortHeaders() {
    $$(".database-sort-button").forEach((button) => {
      const active = button.dataset.databaseSort === state.databaseSortKey;
      button.classList.toggle("is-active", active);
      const indicator = button.querySelector("i");
      if (indicator) indicator.textContent = active
        ? (state.databaseSortDirection === "desc" ? "↓" : "↑")
        : "↕";
    });
  }

  function renderDatabaseEvents() {
    const query = elements.databaseSearch.value.trim().toLocaleLowerCase();
    const selectedState = elements.databaseStateFilter.value.toLocaleLowerCase();
    const direction = state.databaseSortDirection === "desc" ? -1 : 1;
    const fromTimestamp = monthStart(elements.databaseFromMonth.value);
    const toExclusiveTimestamp = monthAfter(elements.databaseToMonth.value);
    const invalidPeriod = fromTimestamp !== null && toExclusiveTimestamp !== null && fromTimestamp >= toExclusiveTimestamp;
    const rows = state.databaseEvents
      .filter((event) => {
        const matchesState = selectedState === "all" || event.stateLower === selectedState;
        const matchesFault = state.selectedDatabaseFaults.has(databaseFaultIdentity(event));
        const matchesFrom = fromTimestamp === null || event.timestampMs >= fromTimestamp;
        const matchesTo = toExclusiveTimestamp === null || event.timestampMs < toExclusiveTimestamp;
        const haystack = `${event.record} ${event.eventCode} ${event.description} ${event.mode} ${event.state} ${event.sourceFile} ${event.softwareVersion}`.toLocaleLowerCase();
        return !invalidPeriod && matchesState && matchesFault && matchesFrom && matchesTo && (!query || haystack.includes(query));
      })
      .sort(compareDatabaseEvents);
    state.databaseRows = rows;
    elements.databaseEventBody.innerHTML = rows.map((event, index) => `<tr>
      <td class="cell-mono" title="${escapeHtml(event.sourceFile)}">${index + 1}</td>
      <td class="nowrap cell-strong">${escapeHtml(dateFormatter.format(event.date))}</td>
      <td class="nowrap cell-strong">${escapeHtml(timeFormatter.format(event.date))}</td>
      <td><span class="code-chip">${escapeHtml(event.eventCode)}</span></td>
      <td class="description-cell" title="Source: ${escapeHtml(event.sourceFile)}">${escapeHtml(event.description)}</td>
      <td><span class="status-badge ${stateClass(event.state)}">${escapeHtml(event.state)}</span></td>
      <td class="clearance-cell">${event.clearedAtMs ? escapeHtml(dateTimeFormatter.format(new Date(event.clearedAtMs))) : "—"}</td>
      <td class="nowrap">${event.stateLower === "fail" ? escapeHtml(formatDuration(event.durationMs)) : "—"}</td>
      <td class="nowrap">${escapeHtml(event.mode)}</td>
      <td class="cell-mono" title="${escapeHtml(event.sourceFile)}">${escapeHtml(event.record)}</td>
      ${PRESSURE_SENSOR_FIELDS.map(([field]) => `<td class="cell-number" title="${escapeHtml(sensorTitle(event, field))}">${escapeHtml(sensorDisplay(event, field))}</td>`).join("")}
    </tr>`).join("");
    elements.databaseEventWrap.hidden = rows.length === 0;
    elements.databaseEmpty.hidden = rows.length !== 0 || state.databaseLocomotives.length === 0;
    renderDatabaseSortHeaders();
    if (!rows.length && state.databaseLocomotives.length) {
      elements.databaseEmpty.hidden = false;
      elements.databaseEmpty.querySelector("strong").textContent = invalidPeriod ? "Invalid month range" : "No matching stored events";
      elements.databaseEmpty.querySelector("p").textContent = invalidPeriod
        ? "The From month/year must be earlier than or equal to the To month/year."
        : "Change the search, state, or month/year range to retrieve more records.";
    }
    const locomotiveNumber = elements.databaseLocomotiveSelect.value;
    const sortLabels = { serial: "source row", timestamp: "event time", event: "event code", description: "description", state: "state", cleared: "cleared time", duration: "duration", mode: "mode", record: "record", mrt: "MRT", bpt: "BPT", bpAlt: "BPalt", ert: "ERT", twentyTl: "20TL", twentyTt: "20TT", tenT: "10T", bct: "BCT", flt: "FLT" };
    const orderLabel = `${sortLabels[state.databaseSortKey] || "event time"}, ${direction === 1 ? "ascending" : "descending"}`;
    const periodParts = [];
    if (fromTimestamp !== null) periodParts.push(`from ${monthYearFormatter.format(new Date(fromTimestamp))}`);
    if (toExclusiveTimestamp !== null) periodParts.push(`to ${monthYearFormatter.format(new Date(toExclusiveTimestamp - 1))}`);
    $("#database-result-note").textContent = invalidPeriod
      ? "Invalid period: From month/year must not be later than To month/year."
      : locomotiveNumber
        ? `Locomotive ${locomotiveNumber}: showing ${rows.length.toLocaleString("en-IN")} of ${state.databaseEvents.length.toLocaleString("en-IN")} stored Event Log records, ${orderLabel}${periodParts.length ? ` · ${periodParts.join(" ")}` : ""}.`
        : "No locomotive is selected.";
  }

  async function loadDatabaseLocomotive(locomotiveNumber) {
    if (!locomotiveNumber) {
      $("#database-panel").classList.remove("has-selected-locomotive");
      state.databaseFaultOptions = [];
      state.selectedDatabaseFaults.clear();
      elements.databaseFaultOptions.innerHTML = "";
      updateDatabaseFaultFilterControl();
      state.databaseEvents = [];
      state.databaseRows = [];
      elements.databaseEventBody.innerHTML = "";
      elements.databaseEventWrap.hidden = true;
      elements.databaseEmpty.hidden = true;
      $("#database-result-note").textContent = "All stored locomotives are listed above. Select a locomotive number to display only its Event Log data.";
      return;
    }
    $("#database-panel").classList.add("has-selected-locomotive");
    $("#database-result-note").textContent = `Fetching Locomotive ${locomotiveNumber} from the offline database…`;
    state.databaseEvents = await FleetDatabase.getEvents(locomotiveNumber);
    populateDatabaseFaultFilter(state.databaseEvents);
    elements.databaseLocomotiveSelect.value = locomotiveNumber;
    renderDatabaseEvents();
    $(".database-toolbar").scrollIntoView({ behavior: "auto", block: "start" });
  }

  function matrixCountForLocomotive(row, locomotiveNumber) {
    const source = row.counts || row.byLocomotive || row.locomotiveCounts || {};
    const value = source instanceof Map ? source.get(locomotiveNumber) : source[locomotiveNumber];
    return Number(value) || 0;
  }

  function matrixFaultIdentity(row) {
    return `${String(row.eventCode || "").trim().toLocaleUpperCase()}\u241f${String(row.description || "").trim().toLocaleLowerCase()}`;
  }

  function updateMatrixFaultFilterControl() {
    const button = $("#matrix-fault-filter-button");
    if (!button) return;
    const total = state.matrixFaultOptions.length;
    const selected = state.selectedMatrixFaults.size;
    elements.matrixFaultSelectAll.checked = total > 0 && selected === total;
    elements.matrixFaultSelectAll.indeterminate = selected > 0 && selected < total;
    button.classList.toggle("has-filter", selected < total);
    button.title = selected === total
      ? `All ${total.toLocaleString("en-IN")} fault names selected`
      : `${selected.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} fault names selected`;
  }

  function buildFleetMatrixHead(locomotives) {
    elements.fleetMatrixHead.innerHTML = `<tr>
      <th class="matrix-fault-cell matrix-fault-heading">
        <div class="matrix-fault-heading-actions"><span>Fault name</span><button class="matrix-fault-filter-button" id="matrix-fault-filter-button" type="button" aria-expanded="false" aria-controls="matrix-fault-filter-menu" title="Select fault names">☑</button></div>
      </th>
      <th class="matrix-total-cell">Total</th>
      ${locomotives.map((locomotive) => `<th title="Locomotive ${escapeHtml(locomotive)}">${escapeHtml(locomotive)}</th>`).join("")}
    </tr>`;
    elements.matrixFaultOptions.innerHTML = state.matrixFaultOptions.map((row) => `<label class="check-filter-option"><input class="matrix-fault-option" type="checkbox" data-matrix-fault="${escapeHtml(matrixFaultIdentity(row))}" checked /><span><strong>Event ${escapeHtml(row.eventCode)}</strong><small>${escapeHtml(row.description)}</small></span></label>`).join("");
    elements.matrixFaultFilterMenu.hidden = true;
    updateMatrixFaultFilterControl();
  }

  function renderFleetMatrixRows() {
    const { locomotives = [], rows = [] } = state.fleetFaultMatrix || {};
    const visibleRows = rows.filter((row) => state.selectedMatrixFaults.has(matrixFaultIdentity(row)));
    elements.fleetMatrixBody.innerHTML = visibleRows.map((row, index) => `<tr>
      <td class="matrix-fault-cell"><strong>${index + 1}. ${escapeHtml(row.description)}</strong><small>${row.eventCode ? `Event ${escapeHtml(row.eventCode)}` : "Fault event"}</small></td>
      <td class="matrix-total-cell">${row.total.toLocaleString("en-IN")}</td>
      ${locomotives.map((locomotive) => {
        const count = matrixCountForLocomotive(row, locomotive);
        return count
          ? `<td class="matrix-count"><button class="matrix-count-button" type="button" data-locomotive="${escapeHtml(locomotive)}" data-event-code="${escapeHtml(row.eventCode)}" data-fault-name="${escapeHtml(row.description)}" aria-label="View ${count.toLocaleString("en-IN")} occurrences for ${escapeHtml(row.description)} on Locomotive ${escapeHtml(locomotive)}">${count.toLocaleString("en-IN")}</button></td>`
          : `<td class="matrix-zero">0</td>`;
      }).join("")}
    </tr>`).join("");
    const grandTotal = visibleRows.reduce((sum, row) => sum + row.total, 0);
    elements.fleetAnalysisSummary.textContent = `Showing ${visibleRows.length.toLocaleString("en-IN")} of ${rows.length.toLocaleString("en-IN")} fault types · ${locomotives.length.toLocaleString("en-IN")} locomotives · ${grandTotal.toLocaleString("en-IN")} visible fault occurrences · sorted highest to lowest.`;
  }

  async function renderFleetAnalysis() {
    elements.fleetAnalysisSummary.textContent = "Calculating fault occurrences across the stored fleet database\u2026";
    elements.fleetMatrixWrap.hidden = true;
    elements.fleetAnalysisEmpty.hidden = true;
    if (typeof FleetDatabase.getFaultMatrix !== "function") {
      throw new Error("The fault-matrix database service is not available yet.");
    }

    const matrix = await FleetDatabase.getFaultMatrix();
    const locomotives = (matrix?.locomotives || [])
      .map((item) => String(item?.locomotiveNumber ?? item))
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    const rows = (matrix?.rows || []).map((row) => {
      const calculatedTotal = locomotives.reduce((sum, locomotive) => sum + matrixCountForLocomotive(row, locomotive), 0);
      return {
        ...row,
        total: Number(row.total ?? row.totalCount) || calculatedTotal,
        description: String(row.description || row.faultName || row.fault || "Unknown fault"),
        eventCode: String(row.eventCode ?? row.code ?? ""),
      };
    }).sort((left, right) => right.total - left.total
      || left.description.localeCompare(right.description, undefined, { numeric: true }));
    state.fleetFaultMatrix = { locomotives, rows };
    state.matrixFaultOptions = rows;
    state.selectedMatrixFaults = new Set(rows.map(matrixFaultIdentity));

    if (!locomotives.length || !rows.length) {
      elements.fleetMatrixHead.innerHTML = "";
      elements.fleetMatrixBody.innerHTML = "";
      elements.fleetAnalysisSummary.textContent = "No Fail-state Event Log occurrences are stored yet.";
      elements.fleetAnalysisEmpty.hidden = false;
      return;
    }

    buildFleetMatrixHead(locomotives);
    renderFleetMatrixRows();
    elements.fleetMatrixWrap.hidden = false;
  }

  async function openMatrixOccurrences(button) {
    const locomotiveNumber = button.dataset.locomotive;
    const eventCode = button.dataset.eventCode;
    const faultName = button.dataset.faultName;
    elements.matrixOccurrenceTitle.textContent = faultName;
    elements.matrixOccurrenceContext.textContent = `Locomotive ${locomotiveNumber} · Event ${eventCode} · loading fault dates…`;
    elements.matrixOccurrenceBody.innerHTML = "";
    elements.matrixOccurrenceEmpty.hidden = true;
    elements.matrixOccurrenceSummary.textContent = "Loading occurrences…";
    elements.matrixOccurrenceModal.hidden = false;
    document.body.classList.add("modal-open");
    $("#close-matrix-occurrence").focus();

    try {
      const codeIdentity = String(eventCode || "").trim().toLocaleUpperCase();
      const descriptionIdentity = String(faultName || "").trim().toLocaleLowerCase();
      const occurrences = (await FleetDatabase.getEvents(locomotiveNumber, "desc"))
        .filter((event) => event.stateLower === "fail"
          && String(event.eventCode || "").trim().toLocaleUpperCase() === codeIdentity
          && String(event.description || "").trim().toLocaleLowerCase() === descriptionIdentity)
        .sort((left, right) => right.timestampMs - left.timestampMs || right.originalIndex - left.originalIndex);
      const dateCount = new Set(occurrences.map((event) => event.dateKey)).size;
      elements.matrixOccurrenceBody.innerHTML = occurrences.map((event, index) => `<tr>
        <td class="cell-number">${index + 1}</td>
        <td class="nowrap cell-strong">${escapeHtml(dateFormatter.format(event.date))}</td>
        <td class="nowrap cell-strong">${escapeHtml(timeFormatter.format(event.date))}</td>
        <td>${escapeHtml(event.mode)}</td>
        <td class="cell-mono">${escapeHtml(event.record)}</td>
        <td class="filename-cell">${escapeHtml(event.sourceFile)}</td>
      </tr>`).join("");
      elements.matrixOccurrenceEmpty.hidden = occurrences.length !== 0;
      elements.matrixOccurrenceContext.textContent = `Locomotive ${locomotiveNumber} · Event ${eventCode} · ${occurrences.length.toLocaleString("en-IN")} occurrence${occurrences.length === 1 ? "" : "s"} across ${dateCount.toLocaleString("en-IN")} date${dateCount === 1 ? "" : "s"}`;
      elements.matrixOccurrenceSummary.textContent = `${occurrences.length.toLocaleString("en-IN")} fault occurrence${occurrences.length === 1 ? "" : "s"}`;
    } catch (error) {
      elements.matrixOccurrenceEmpty.hidden = false;
      elements.matrixOccurrenceEmpty.querySelector("strong").textContent = "Unable to load fault dates";
      elements.matrixOccurrenceEmpty.querySelector("p").textContent = error.message;
      elements.matrixOccurrenceSummary.textContent = "Occurrence lookup failed";
    }
  }

  function closeMatrixOccurrences() {
    elements.matrixOccurrenceModal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  async function openFleetAnalysisDashboard() {
    const summary = await FleetDatabase.getSummary();
    setMetricLabels(true);
    elements.reportTitle.textContent = "Analysis of Data";
    elements.reportMeta.textContent = "Fault occurrence comparison across the complete stored locomotive database";
    elements.softwareVersion.textContent = "Multiple reports";
    $("#metric-faults").textContent = summary.faultCount.toLocaleString("en-IN");
    $("#metric-dates").textContent = summary.locomotiveCount.toLocaleString("en-IN");
    $("#metric-cleared").textContent = summary.reportCount.toLocaleString("en-IN");
    $("#metric-clear-rate").textContent = `${summary.clearedCount.toLocaleString("en-IN")} cleared failures`;
    $("#metric-events").textContent = summary.eventCount.toLocaleString("en-IN");
    $("#metric-range").textContent = summary.eventCount
      ? `${dateFormatter.format(new Date(summary.firstTimestampMs))} \u2014 ${dateFormatter.format(new Date(summary.lastTimestampMs))}`
      : "No stored events";
    elements.uploadCard.hidden = true;
    elements.dashboard.hidden = false;
    switchTab("analysis");
    await renderFleetAnalysis();
    elements.dashboard.scrollIntoView({ behavior: "auto", block: "start" });
  }

  async function renderStatistics() {
    const summary = await FleetDatabase.getSummary();
    const unresolvedCount = Math.max(0, summary.faultCount - summary.clearedCount);
    const clearanceRate = summary.faultCount
      ? Math.round((summary.clearedCount / summary.faultCount) * 100)
      : 0;
    elements.statisticsLocomotives.textContent = summary.locomotiveCount.toLocaleString("en-IN");
    elements.statisticsReports.textContent = summary.reportCount.toLocaleString("en-IN");
    elements.statisticsEvents.textContent = summary.eventCount.toLocaleString("en-IN");
    elements.statisticsFaults.textContent = summary.faultCount.toLocaleString("en-IN");
    elements.statisticsCleared.textContent = summary.clearedCount.toLocaleString("en-IN");
    elements.statisticsUnresolved.textContent = unresolvedCount.toLocaleString("en-IN");
    elements.statisticsClearanceRate.textContent = `${clearanceRate}%`;
    elements.statisticsPeriod.textContent = summary.eventCount
      ? `${dateFormatter.format(new Date(summary.firstTimestampMs))} — ${dateFormatter.format(new Date(summary.lastTimestampMs))}`
      : "No stored events";
  }

  async function openStatisticsDashboard() {
    elements.uploadCard.hidden = true;
    elements.dashboard.hidden = false;
    switchTab("statistics");
    await renderStatistics();
    elements.dashboard.scrollIntoView({ behavior: "auto", block: "start" });
  }

  async function refreshDatabaseView(preferredLocomotive) {
    state.databaseLocomotives = await FleetDatabase.getLocomotives();
    const summary = await FleetDatabase.getSummary();
    elements.headerDatabaseCount.textContent = summary.locomotiveCount.toLocaleString("en-IN");
    $("#database-tab-count").textContent = summary.locomotiveCount.toLocaleString("en-IN");
    $("#database-metric-locomotives").textContent = summary.locomotiveCount.toLocaleString("en-IN");
    $("#database-metric-reports").textContent = summary.reportCount.toLocaleString("en-IN");
    $("#database-metric-events").textContent = summary.eventCount.toLocaleString("en-IN");
    $("#database-metric-faults").textContent = summary.faultCount.toLocaleString("en-IN");
    renderDatabaseSummaryRows();

    const previousSelection = preferredLocomotive !== undefined
      ? String(preferredLocomotive || "")
      : elements.databaseLocomotiveSelect.value;
    elements.databaseLocomotiveSelect.replaceChildren();
    elements.databaseLocomotiveSelect.append(option("", "Select a locomotive number"));
    state.databaseLocomotives.forEach((locomotive) => {
      elements.databaseLocomotiveSelect.append(option(locomotive.locomotiveNumber, `Locomotive ${locomotive.locomotiveNumber}`));
    });
    const selected = state.databaseLocomotives.some((item) => item.locomotiveNumber === previousSelection)
      ? previousSelection
      : "";
    if (!selected) {
      $("#database-panel").classList.remove("has-selected-locomotive");
      state.databaseEvents = [];
      state.databaseRows = [];
      elements.databaseEventBody.innerHTML = "";
      elements.databaseEventWrap.hidden = true;
      if (!state.databaseLocomotives.length) {
        elements.databaseEmpty.hidden = false;
        elements.databaseEmpty.querySelector("strong").textContent = "No stored fleet data";
        elements.databaseEmpty.querySelector("p").textContent = "Bulk upload one or more CCB TXT reports to populate the offline database.";
        $("#database-result-note").textContent = "The offline fleet database is ready for TXT reports.";
      } else {
        elements.databaseEmpty.hidden = true;
        $("#database-result-note").textContent = "All stored locomotives are listed. Select a locomotive number below to display only its Event Log data.";
      }
      return summary;
    }
    elements.databaseEmpty.hidden = true;
    await loadDatabaseLocomotive(selected);
    return summary;
  }

  async function openFleetDatabaseDashboard(preferredLocomotive) {
    const summary = await refreshDatabaseView(preferredLocomotive);
    setMetricLabels(true);
    elements.reportTitle.textContent = "Fleet Database";
    elements.reportMeta.textContent = `${summary.reportCount.toLocaleString("en-IN")} stored report${summary.reportCount === 1 ? "" : "s"} · Persistent offline IndexedDB storage`;
    elements.softwareVersion.textContent = "Multiple reports";
    $("#metric-faults").textContent = summary.faultCount.toLocaleString("en-IN");
    $("#metric-dates").textContent = summary.locomotiveCount.toLocaleString("en-IN");
    $("#metric-cleared").textContent = summary.reportCount.toLocaleString("en-IN");
    $("#metric-clear-rate").textContent = `${summary.clearedCount.toLocaleString("en-IN")} cleared failures`;
    $("#metric-events").textContent = summary.eventCount.toLocaleString("en-IN");
    $("#metric-range").textContent = summary.eventCount
      ? `${dateFormatter.format(new Date(summary.firstTimestampMs))} — ${dateFormatter.format(new Date(summary.lastTimestampMs))}`
      : "No stored events";
    elements.uploadCard.hidden = true;
    elements.dashboard.hidden = false;
    switchTab("database");
    elements.dashboard.scrollIntoView({ behavior: "auto", block: "start" });
  }

  async function openDedicatedLocomotivePage(locomotiveNumber) {
    await openFleetDatabaseDashboard(locomotiveNumber);
    const selected = state.databaseLocomotives.find((item) => item.locomotiveNumber === locomotiveNumber);
    if (!selected) {
      elements.reportTitle.textContent = `Locomotive ${locomotiveNumber} not found`;
      elements.reportMeta.textContent = "This locomotive number is not present in the offline database.";
      return;
    }
    document.body.classList.add("loco-data-page");
    document.title = `Locomotive ${locomotiveNumber} · CCB Fault Analyser`;
    elements.reportTitle.textContent = `Locomotive ${locomotiveNumber} — Full Stored Data`;
    elements.reportMeta.textContent = `${selected.reportCount.toLocaleString("en-IN")} report${selected.reportCount === 1 ? "" : "s"} · ${selected.eventCount.toLocaleString("en-IN")} events · ${selected.faultCount.toLocaleString("en-IN")} failures`;
    $(".database-intro h3").textContent = `Locomotive ${locomotiveNumber} Event Log Database`;
    $(".database-intro p:last-child").textContent = "Complete stored Event Log data with latest records first. Use From and To month/year to retrieve a specific operating period.";
  }

  function databaseExportData(events) {
    const headers = ["Locomotive", "Source File", "Software Version", "Event Date", "Event Time", "Cleared At", "Duration", "State", "Record", "Event", "Description", "Mode", ...PRESSURE_SENSOR_FIELDS.map(([, label]) => `${label} (kg/cm²)`)];
    const rows = events.map((event) => [event.locomotiveNumber, event.sourceFile, event.softwareVersion, event.dateKey, timeFormatter.format(event.date), event.clearedAtMs ? dateTimeFormatter.format(new Date(event.clearedAtMs)) : "", event.stateLower === "fail" ? formatDuration(event.durationMs) : "", event.state, event.record, event.eventCode, event.description, event.mode, ...PRESSURE_SENSOR_FIELDS.map(([field]) => sensorDisplay(event, field))]);
    return { headers, rows };
  }

  function exportDatabase(format) {
    if (!state.databaseRows.length) return;
    const locomotiveNumber = elements.databaseLocomotiveSelect.value || "fleet";
    const data = databaseExportData(state.databaseRows);
    const fileName = `Locomotive-${locomotiveNumber}-stored-event-log`;
    if (format === "excel") downloadExcel(`${fileName}.xlsx`, "Stored Event Log", data.headers, data.rows);
    else downloadPdf(`${fileName}.pdf`, `CCB Stored Event Log — Locomotive ${locomotiveNumber}`, data.headers, data.rows);
  }

  function populateFilters(report) {
    const eventDates = [...new Set(report.events.map((event) => event.dateKey))]
      .sort((a, b) => b.localeCompare(a))
      .map((dateKey) => ({ value: dateKey, label: dateFormatter.format(new Date(`${dateKey}T12:00:00`)) }));
    const states = [...new Set(report.events.map((event) => event.state))]
      .sort()
      .map((value) => ({ value: value.toLocaleLowerCase(), label: value }));
    setSelectOptions(elements.faultDateFilter, eventDates, "All event dates");
    setSelectOptions(elements.eventDateFilter, eventDates, "All dates");
    setSelectOptions(elements.stateFilter, states, "All states");
  }

  function showReport(report) {
    state.report = report;
    setMetricLabels(false);
    elements.reportTitle.textContent = report.locomotiveNumber
      ? `Locomotive ${report.locomotiveNumber}`
      : report.fileName;
    const meta = [report.fileName];
    if (report.malformedRows) meta.push(`${report.malformedRows} malformed rows skipped`);
    elements.reportMeta.textContent = meta.join(" · ");
    elements.softwareVersion.textContent = report.softwareVersion || report.reportId || "Not available";
    saveSoftwareVersion(report);
    saveLoadingLog(report);
    saveStoredFaultLog(report);
    $("#metric-faults").textContent = report.summary.faultCount.toLocaleString("en-IN");
    $("#metric-dates").textContent = report.summary.faultDateCount.toLocaleString("en-IN");
    $("#metric-cleared").textContent = report.summary.clearedCount.toLocaleString("en-IN");
    const clearRate = report.summary.faultCount
      ? Math.round((report.summary.clearedCount / report.summary.faultCount) * 100)
      : 0;
    $("#metric-clear-rate").textContent = `${clearRate}% of failures`;
    $("#metric-events").textContent = report.summary.eventCount.toLocaleString("en-IN");
    $("#metric-range").textContent = `${dateFormatter.format(report.summary.firstEvent.date)} — ${dateFormatter.format(report.summary.lastEvent.date)}`;
    $("#fault-tab-count").textContent = report.summary.eventCount;
    $("#population-tab-count").textContent = buildPopulationGroups(report).length;
    $("#event-tab-count").textContent = report.summary.eventCount;

    elements.faultSearch.value = "";
    elements.faultSort.value = "timestamp:asc";
    populateFilters(report);
    populateFaultChecklist(report);
    renderFaults();
    renderPopulation();
    renderEvents();
    elements.uploadCard.hidden = true;
    elements.dashboard.hidden = false;
    switchTab("faults");
    elements.dashboard.scrollIntoView({ behavior: "auto", block: "start" });
  }

  function locomotiveFromFolderPath(file) {
    const folders = String(file?.webkitRelativePath || "").split("/").slice(0, -1);
    return [...folders].reverse().find((folder) => /^\d{4,6}$/.test(folder)) || null;
  }

  async function handleFiles(fileList, options = {}) {
    hideImportResult();
    const selectedFiles = [...(fileList || [])];
    const folderUpload = Boolean(options.folderUpload);
    const files = folderUpload
      ? selectedFiles.filter((file) => /\.txt$/i.test(file.name))
      : selectedFiles;
    const ignoredNonTxtCount = folderUpload ? selectedFiles.length - files.length : 0;
    if (!files.length) {
      elements.uploadMessage.textContent = folderUpload
        ? `No TXT files were found in the selected folder or any nested subfolder.${ignoredNonTxtCount ? ` ${ignoredNonTxtCount} non-TXT file${ignoredNonTxtCount === 1 ? " was" : "s were"} ignored.` : ""}`
        : "No files were selected.";
      elements.uploadMessage.className = "upload-message is-error";
      return;
    }
    const folderName = folderUpload ? String(files[0].webkitRelativePath || "").split("/")[0] : "";
    elements.uploadMessage.textContent = folderUpload
      ? `Scanning ${folderName || "selected folder"} to the deepest subfolder: ${files.length} TXT file${files.length === 1 ? "" : "s"} found${ignoredNonTxtCount ? `; ${ignoredNonTxtCount} other file${ignoredNonTxtCount === 1 ? "" : "s"} ignored` : ""}…`
      : `Reading ${files.length} TXT report${files.length === 1 ? "" : "s"}…`;
    elements.uploadMessage.className = "upload-message";

    const results = await Promise.all(files.map(async (file) => {
      if (!/\.txt$/i.test(file.name) && file.type !== "text/plain") {
        throw new Error(`${file.name}: not a TXT report.`);
      }
      const rawText = await file.text();
      const report = parseEventLog(rawText, file.name);
      const folderLocomotive = folderUpload ? locomotiveFromFolderPath(file) : null;
      if (!report.locomotiveNumber && folderLocomotive) {
        report.locomotiveNumber = folderLocomotive;
        report.locomotiveNumberSource = "folder";
      }
      return { report, rawText };
    }).map((task) => task.then((value) => ({ status: "fulfilled", value }), (reason) => ({ status: "rejected", reason }))));

    const parsedEntries = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
    const rejected = results.filter((result) => result.status === "rejected");
    if (!parsedEntries.length) {
      elements.dashboard.hidden = true;
      elements.uploadCard.hidden = false;
      const failureMessage = rejected.map((result) => result.reason?.message || "A report could not be read.").join(" ");
      elements.uploadMessage.textContent = failureMessage;
      elements.uploadMessage.className = "upload-message is-error";
      await showImportResult("error", "Upload failed", `${files.length.toLocaleString("en-IN")} TXT file${files.length === 1 ? "" : "s"} checked · 0 valid reports stored. ${failureMessage}`);
      window.dispatchEvent(new CustomEvent("ccb:import-complete", { detail: { success: false, parsedCount: 0 } }));
      return;
    }

    const databaseEntries = parsedEntries.filter(({ report }) => report.locomotiveNumber);
    const missingLocomotive = parsedEntries.filter(({ report }) => !report.locomotiveNumber);
    let databaseError = null;
    let databaseSaveResult = { savedCount: 0, duplicateCount: 0, skippedDuplicateEventCount: 0, storedEventCount: 0, results: [] };
    if (databaseEntries.length) {
      try {
        elements.uploadMessage.textContent = `Parsed ${parsedEntries.length} report${parsedEntries.length === 1 ? "" : "s"}; saving ${databaseEntries.length} to the fleet database…`;
        databaseSaveResult = await FleetDatabase.saveReports(databaseEntries);
      } catch (error) {
        databaseError = error;
      }
    }

    const totalEvents = parsedEntries.reduce((total, entry) => total + entry.report.events.length, 0);
    const messages = [
      `${files.length} TXT file${files.length === 1 ? "" : "s"} found.`,
      `${databaseSaveResult.savedCount} new report${databaseSaveResult.savedCount === 1 ? "" : "s"} uploaded to the database.`,
      `${databaseSaveResult.duplicateCount} duplicate or fully overlapping report${databaseSaveResult.duplicateCount === 1 ? "" : "s"} not uploaded.`,
      `${parsedEntries.length} valid report${parsedEntries.length === 1 ? "" : "s"} contained ${totalEvents.toLocaleString("en-IN")} Event Log rows.`,
    ];
    if (databaseSaveResult.skippedDuplicateEventCount) messages.push(`${databaseSaveResult.skippedDuplicateEventCount.toLocaleString("en-IN")} duplicate Event Log row${databaseSaveResult.skippedDuplicateEventCount === 1 ? "" : "s"} ${databaseSaveResult.skippedDuplicateEventCount === 1 ? "was" : "were"} not stored (same locomotive, fault occurrence start second, event code, and state).`);
    if (missingLocomotive.length) messages.push(`${missingLocomotive.length} report${missingLocomotive.length === 1 ? "" : "s"} not stored because the locomotive number was unavailable.`);
    if (rejected.length) messages.push(`${rejected.length} invalid report${rejected.length === 1 ? "" : "s"} skipped.`);
    if (ignoredNonTxtCount) messages.push(`${ignoredNonTxtCount} non-TXT file${ignoredNonTxtCount === 1 ? " was" : "s were"} ignored.`);
    if (databaseError) messages.push(`Database error: ${databaseError.message}`);
    elements.uploadMessage.textContent = messages.join(" ");
    const duplicateOnly = !databaseError
      && databaseEntries.length > 0
      && databaseSaveResult.savedCount === 0
      && databaseSaveResult.duplicateCount > 0;
    elements.uploadMessage.className = databaseError || duplicateOnly ? "upload-message is-error" : "upload-message is-success";

    const uploadDetail = `${files.length.toLocaleString("en-IN")} TXT found · ${databaseSaveResult.savedCount.toLocaleString("en-IN")} new report${databaseSaveResult.savedCount === 1 ? "" : "s"} stored · ${databaseSaveResult.duplicateCount.toLocaleString("en-IN")} duplicate report${databaseSaveResult.duplicateCount === 1 ? "" : "s"} not stored · ${databaseSaveResult.storedEventCount.toLocaleString("en-IN")} new Event Log row${databaseSaveResult.storedEventCount === 1 ? "" : "s"} stored · ${databaseSaveResult.skippedDuplicateEventCount.toLocaleString("en-IN")} duplicate row${databaseSaveResult.skippedDuplicateEventCount === 1 ? "" : "s"} rejected.`;
    if (databaseError) {
      await showImportResult("error", "Upload database error", `${uploadDetail} ${databaseError.message}`);
    } else if (duplicateOnly) {
      const duplicateNames = databaseSaveResult.results
        .filter((result) => result.status === "duplicate" || result.status === "duplicate_overlap")
        .map((result) => result.fileName)
        .join(", ");
      await showImportResult("duplicate", "Duplicate upload rejected", `${duplicateNames || "The selected report"} is already stored or fully overlaps existing data. ${uploadDetail}`);
    } else if (databaseSaveResult.duplicateCount || databaseSaveResult.skippedDuplicateEventCount) {
      await showImportResult("warning", "Upload completed with duplicates", uploadDetail);
    } else {
      await showImportResult("success", "Upload completed", uploadDetail);
    }

    showReport(parsedEntries[0].report);

    if (files.length > 1 && databaseEntries.length && !databaseError) {
      await openFleetDatabaseDashboard(databaseEntries[0].report.locomotiveNumber);
      elements.reportMeta.textContent = messages.join(" ");
    } else if (!databaseError) {
      const summary = await FleetDatabase.getSummary();
      elements.headerDatabaseCount.textContent = summary.locomotiveCount.toLocaleString("en-IN");
      $("#database-tab-count").textContent = summary.locomotiveCount.toLocaleString("en-IN");
    }
    window.dispatchEvent(new CustomEvent("ccb:import-complete", {
      detail: { success: !databaseError, parsedCount: parsedEntries.length, storedCount: databaseSaveResult.savedCount, duplicateCount: databaseSaveResult.duplicateCount },
    }));
  }

  function downloadBlob(fileName, blob) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function xmlEscape(value) {
    return String(value ?? "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function excelColumnName(index) {
    let value = index + 1;
    let name = "";
    while (value) {
      value -= 1;
      name = String.fromCharCode(65 + (value % 26)) + name;
      value = Math.floor(value / 26);
    }
    return name;
  }

  function uint16(value) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    return bytes;
  }

  function uint32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    return bytes;
  }

  function combineBytes(parts) {
    const total = parts.reduce((size, part) => size + part.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let crc = index;
      for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      table[index] = crc >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function createZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = encoder.encode(file.content);
      const checksum = crc32(data);
      const localHeader = combineBytes([
        uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0), uint16(dosTime), uint16(dosDate),
        uint32(checksum), uint32(data.length), uint32(data.length), uint16(name.length), uint16(0), name,
      ]);
      localParts.push(localHeader, data);

      centralParts.push(combineBytes([
        uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(0), uint16(dosTime), uint16(dosDate),
        uint32(checksum), uint32(data.length), uint32(data.length), uint16(name.length), uint16(0), uint16(0),
        uint16(0), uint16(0), uint32(0), uint32(localOffset), name,
      ]));
      localOffset += localHeader.length + data.length;
    }

    const centralDirectory = combineBytes(centralParts);
    const endRecord = combineBytes([
      uint32(0x06054b50), uint16(0), uint16(0), uint16(files.length), uint16(files.length),
      uint32(centralDirectory.length), uint32(localOffset), uint16(0),
    ]);
    return combineBytes([...localParts, centralDirectory, endRecord]);
  }

  function downloadExcel(fileName, sheetName, headers, rows) {
    const allRows = [headers, ...rows];
    const lastColumn = excelColumnName(Math.max(0, headers.length - 1));
    const columnWidths = headers.map((_, columnIndex) => {
      const width = Math.max(...allRows.map((row) => String(row[columnIndex] ?? "").length));
      return Math.min(45, Math.max(10, width + 2));
    });
    const rowXml = allRows.map((row, rowIndex) => {
      const cells = headers.map((_, columnIndex) => {
        const value = row[columnIndex] ?? "";
        const reference = `${excelColumnName(columnIndex)}${rowIndex + 1}`;
        if (rowIndex > 0 && typeof value === "number" && Number.isFinite(value)) {
          return `<c r="${reference}"><v>${value}</v></c>`;
        }
        return `<c r="${reference}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
      }).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");
    const safeSheetName = String(sheetName).replace(/[\\/*?:\[\]]/g, " ").slice(0, 31) || "CCB Data";
    const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${allRows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columnWidths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${rowXml}</sheetData><autoFilter ref="A1:${lastColumn}${allRows.length}"/></worksheet>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16323E"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const files = [
      { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
      { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", content: styles },
      { name: "xl/worksheets/sheet1.xml", content: worksheet },
    ];
    downloadBlob(fileName, new Blob([createZip(files)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  function pdfSafeText(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  function wrapPdfLine(value, maxLength = 126) {
    const words = String(value ?? "").replace(/\s+/g, " ").trim().split(" ");
    const lines = [];
    let line = "";
    for (const word of words) {
      if (line && `${line} ${word}`.length > maxLength) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line || !lines.length) lines.push(line);
    return lines;
  }

  function downloadPdf(fileName, title, headers, rows) {
    const bodyLines = [
      `${title} | ${state.report ? state.report.fileName : "CCB report"}`,
      `Generated ${dateTimeFormatter.format(new Date())}`,
      "",
      headers.join(" | "),
      "-".repeat(126),
    ];
    rows.forEach((row, index) => {
      const wrapped = wrapPdfLine(row.join(" | "));
      bodyLines.push(`${index + 1}. ${wrapped[0]}`, ...wrapped.slice(1).map((line) => `   ${line}`));
    });

    const linesPerPage = 46;
    const pages = [];
    for (let index = 0; index < bodyLines.length; index += linesPerPage) pages.push(bodyLines.slice(index, index + linesPerPage));
    const objects = [];
    const pageIds = pages.map((_, index) => 4 + index * 2);
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>";
    pages.forEach((pageLines, pageIndex) => {
      const pageId = pageIds[pageIndex];
      const contentId = pageId + 1;
      const displayLines = [`${title}  |  Page ${pageIndex + 1} of ${pages.length}`, ...pageLines];
      const commands = `BT\n/F1 7.5 Tf\n36 560 Td\n11 TL\n${displayLines.map((line) => `(${pdfSafeText(line)}) Tj\nT*`).join("")}ET`;
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
      objects[contentId] = `<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`;
    });

    let pdf = "%PDF-1.4\n%CCB-REPORT\n";
    const offsets = [0];
    for (let id = 1; id < objects.length; id += 1) {
      offsets[id] = pdf.length;
      pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    downloadBlob(fileName, new Blob([pdf], { type: "application/pdf" }));
  }

  function reportBaseName() {
    return state.report.fileName.replace(/\.txt$/i, "");
  }

  function faultExportData(eventRows) {
    const headers = ["Event Date", "Event Time", "Cleared At", "Duration", "State", "Record", "Event", "Description", "Mode", ...PRESSURE_SENSOR_FIELDS.map(([, label]) => `${label} (kg/cm²)`)];
    const rows = eventRows.map(({ event, episode }) => {
      const isFailure = event.state.toLocaleLowerCase() === "fail";
      return [event.dateKey, timeFormatter.format(event.date), isFailure && episode?.clearedEvent ? dateTimeFormatter.format(episode.clearedEvent.date) : "", isFailure ? formatDuration(episode?.durationMs ?? null) : "", event.state, event.record, event.eventCode, event.description, event.mode, ...PRESSURE_SENSOR_FIELDS.map(([field]) => sensorDisplay(event, field))];
    });
    return { headers, rows };
  }

  function populationExportData(groups) {
    const headers = ["Event", "Description", "State", "Total Occurrences", "Occurrence No.", "Occurred At", "Matching Clearance", "Duration", "Record", "Mode", ...PRESSURE_SENSOR_FIELDS.map(([, label]) => `${label} (kg/cm²)`)];
    const rows = groups.flatMap((group) => group.occurrences.map((episode, index) => {
      const event = episode.failedEvent;
      const duration = group.state.toLocaleLowerCase() === "fail" ? formatDuration(episode.durationMs) : "";
      return [group.eventCode, group.description, group.state, group.occurrences.length, index + 1, dateTimeFormatter.format(event.date), episode.clearedEvent ? dateTimeFormatter.format(episode.clearedEvent.date) : "", duration, event.record, event.mode, ...PRESSURE_SENSOR_FIELDS.map(([field]) => sensorDisplay(event, field))];
    }));
    return { headers, rows };
  }

  function eventExportData(events) {
    const headers = ["Num", ...PRESSURE_SENSOR_FIELDS.map(([, label]) => `${label} (kg/cm²)`), "Mode", "State", "Time Stamp", "Event", "Description"];
    const rows = events.map((event) => [event.record, ...PRESSURE_SENSOR_FIELDS.map(([field]) => sensorDisplay(event, field)), event.mode, event.state, event.timestampRaw, event.eventCode, event.description]);
    return { headers, rows };
  }

  function exportData(kind, format) {
    if (!state.report) return;
    const configurations = {
      faults: { title: "CCB Complete Chronological Event Log", suffix: "chronological-event-log", sheet: "Chronological Events", data: faultExportData(state.faultRows) },
      population: { title: "CCB Event Data Population", suffix: "data-population", sheet: "Data Population", data: populationExportData(state.populationRows) },
      events: { title: "CCB Event Log Data", suffix: "event-log", sheet: "Event Log", data: eventExportData(state.eventRows) },
    };
    const selected = configurations[kind];
    const fileName = `${reportBaseName()}-${selected.suffix}`;
    if (format === "excel") downloadExcel(`${fileName}.xlsx`, selected.sheet, selected.data.headers, selected.data.rows);
    else downloadPdf(`${fileName}.pdf`, selected.title, selected.data.headers, selected.data.rows);
  }

  function switchTab(tabName) {
    elements.dashboard.classList.toggle("is-compact-database", tabName === "database");
    elements.dashboard.classList.toggle("is-compact-statistics", tabName === "statistics");
    $$(".tab").forEach((tab) => {
      const active = tab.dataset.tab === tabName;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    $$(".tab-panel").forEach((panel) => {
      panel.hidden = panel.id !== `${tabName}-panel`;
    });
    $$(".drawer-view-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.drawerTab === tabName);
    });
  }

  function openOptions() {
    elements.optionsBackdrop.hidden = false;
    elements.optionsTrigger.setAttribute("aria-expanded", "true");
    document.body.classList.add("drawer-open");
    elements.optionsClose.focus();
  }

  function closeOptions() {
    if (elements.optionsBackdrop.hidden) return;
    elements.optionsBackdrop.hidden = true;
    elements.optionsTrigger.setAttribute("aria-expanded", "false");
    document.body.classList.remove("drawer-open");
    elements.optionsTrigger.focus();
  }

  async function activateDrawerView(tabName) {
    closeOptions();
    if (tabName === "statistics") {
      await openStatisticsDashboard();
      return;
    }
    if (tabName === "analysis") {
      await openFleetAnalysisDashboard();
      return;
    }
    if (tabName === "database") {
      await openFleetDatabaseDashboard();
      return;
    }
    if (!state.report && tabName !== "guide") {
      elements.dashboard.hidden = true;
      elements.uploadCard.hidden = false;
      elements.uploadMessage.textContent = "Upload a CCB TXT report first to open this report view, or choose Analysis of Data for the complete stored database.";
      elements.uploadMessage.className = "upload-message";
      elements.uploadCard.scrollIntoView({ behavior: "auto", block: "start" });
      return;
    }
    if (!state.report && tabName === "guide") {
      elements.uploadCard.hidden = true;
      elements.dashboard.hidden = false;
      elements.reportTitle.textContent = "Understand Algorithm";
      elements.reportMeta.textContent = "How CCB TXT files are interpreted, scaled, ordered, and stored";
    }
    switchTab(tabName);
    elements.dashboard.scrollIntoView({ behavior: "auto", block: "start" });
  }

  elements.optionsTrigger.addEventListener("click", openOptions);
  elements.optionsClose.addEventListener("click", closeOptions);
  elements.optionsBackdrop.addEventListener("click", (event) => {
    if (event.target === elements.optionsBackdrop) closeOptions();
  });
  $$(".drawer-view-button").forEach((button) => button.addEventListener("click", () => {
    activateDrawerView(button.dataset.drawerTab).catch((error) => {
      elements.uploadMessage.textContent = `Unable to open this view: ${error.message}`;
      elements.uploadMessage.className = "upload-message is-error";
      elements.fleetAnalysisSummary.textContent = `Analysis error: ${error.message}`;
      elements.fleetAnalysisEmpty.hidden = false;
    });
  }));
  elements.drawerUploadFiles.addEventListener("click", () => {
    closeOptions();
    elements.fileInput.click();
  });
  elements.drawerUploadFolder.addEventListener("click", () => {
    closeOptions();
    elements.folderInput.click();
  });
  elements.viewExistingData.addEventListener("click", () => {
    openFleetDatabaseDashboard("").catch((error) => {
      elements.uploadMessage.textContent = `Database error: ${error.message}`;
      elements.uploadMessage.className = "upload-message is-error";
    });
  });
  $("#close-import-result").addEventListener("click", hideImportResult);
  $("#refresh-fleet-analysis").addEventListener("click", () => {
    renderFleetAnalysis().catch((error) => {
      elements.fleetAnalysisSummary.textContent = `Analysis error: ${error.message}`;
      elements.fleetMatrixWrap.hidden = true;
      elements.fleetAnalysisEmpty.hidden = false;
    });
  });
  elements.fleetMatrixBody.addEventListener("click", (event) => {
    const button = event.target.closest(".matrix-count-button");
    if (!button) return;
    openMatrixOccurrences(button);
  });
  elements.fleetMatrixHead.addEventListener("click", (event) => {
    const button = event.target.closest("#matrix-fault-filter-button");
    const menu = elements.matrixFaultFilterMenu;
    if (button && menu) {
      event.stopPropagation();
      const willOpen = menu.hidden;
      menu.hidden = !willOpen;
      button.setAttribute("aria-expanded", String(willOpen));
    }
  });
  elements.matrixFaultFilterMenu.addEventListener("click", (event) => event.stopPropagation());
  elements.matrixFaultFilterMenu.addEventListener("change", (event) => {
    const checkbox = event.target;
    if (!(checkbox instanceof HTMLInputElement)) return;
    if (checkbox.id === "matrix-fault-select-all") {
      state.selectedMatrixFaults.clear();
      $$(".matrix-fault-option").forEach((optionCheckbox) => {
        optionCheckbox.checked = checkbox.checked;
        if (checkbox.checked) state.selectedMatrixFaults.add(optionCheckbox.dataset.matrixFault);
      });
    } else if (checkbox.classList.contains("matrix-fault-option")) {
      if (checkbox.checked) state.selectedMatrixFaults.add(checkbox.dataset.matrixFault);
      else state.selectedMatrixFaults.delete(checkbox.dataset.matrixFault);
    }
    updateMatrixFaultFilterControl();
    renderFleetMatrixRows();
  });
  $("#close-matrix-occurrence").addEventListener("click", closeMatrixOccurrences);
  elements.matrixOccurrenceModal.addEventListener("click", (event) => {
    if (event.target === elements.matrixOccurrenceModal) closeMatrixOccurrences();
  });
  $("#refresh-statistics").addEventListener("click", () => {
    renderStatistics().catch((error) => {
      elements.statisticsPeriod.textContent = `Statistics error: ${error.message}`;
    });
  });

  elements.fileInput.addEventListener("change", async (event) => {
    await handleFiles(event.target.files);
    event.target.value = "";
  });
  elements.folderInput.addEventListener("change", async (event) => {
    await handleFiles(event.target.files, { folderUpload: true });
    event.target.value = "";
  });
  elements.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
  elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("is-dragging"));
  elements.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
    handleFiles(event.dataTransfer.files);
  });
  $("#change-file").addEventListener("click", () => elements.fileInput.click());
  elements.headerDatabaseButton.addEventListener("click", () => {
    closeOptions();
    openFleetDatabaseDashboard().catch((error) => {
      elements.uploadMessage.textContent = `Database error: ${error.message}`;
      elements.uploadMessage.className = "upload-message is-error";
    });
  });
  elements.headerViewLocoButton.addEventListener("click", () => {
    closeOptions();
    openLocoPicker().catch((error) => {
      elements.headerViewLocoButton.title = `Database error: ${error.message}`;
    });
  });
  elements.locoPickerSelect.addEventListener("change", updateLocoPickerSummary);
  elements.openLocoPageButton.addEventListener("click", openSelectedLocoPage);
  $("#close-loco-picker").addEventListener("click", closeLocoPicker);
  $("#cancel-loco-picker").addEventListener("click", closeLocoPicker);
  elements.locoPickerModal.addEventListener("click", (event) => {
    if (event.target === elements.locoPickerModal) closeLocoPicker();
  });
  elements.loadingLogButton.addEventListener("click", () => openLoadingLog(false));
  elements.headerLoadingLogButton.addEventListener("click", () => {
    closeOptions();
    openLoadingLog(true);
  });
  $("#close-loading-log").addEventListener("click", closeLoadingLog);
  elements.loadingLogHistorySelect.addEventListener("change", () => {
    renderLoadingLogEntry(availableLoadingLogs()[Number(elements.loadingLogHistorySelect.value)]);
  });
  elements.loadingLogModal.addEventListener("click", (event) => {
    if (event.target === elements.loadingLogModal) closeLoadingLog();
  });
  elements.storedFaultLogButton.addEventListener("click", () => openStoredFaultLog(false));
  elements.headerStoredFaultButton.addEventListener("click", () => {
    closeOptions();
    openStoredFaultLog(true);
  });
  $("#close-stored-fault-log").addEventListener("click", closeStoredFaultLog);
  elements.storedFaultHistorySelect.addEventListener("change", () => {
    renderStoredFaultLogEntry(availableStoredFaultLogs()[Number(elements.storedFaultHistorySelect.value)]);
  });
  elements.storedFaultLogModal.addEventListener("click", (event) => {
    if (event.target === elements.storedFaultLogModal) closeStoredFaultLog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!elements.optionsBackdrop.hidden) closeOptions();
    if (!elements.loadingLogModal.hidden) closeLoadingLog();
    if (!elements.storedFaultLogModal.hidden) closeStoredFaultLog();
    if (!elements.locoPickerModal.hidden) closeLocoPicker();
    if (!elements.matrixOccurrenceModal.hidden) closeMatrixOccurrences();
    elements.databaseFaultFilterMenu.hidden = true;
    elements.databaseFaultFilterButton.setAttribute("aria-expanded", "false");
    const matrixFaultMenu = elements.matrixFaultFilterMenu;
    const matrixFaultButton = $("#matrix-fault-filter-button");
    if (matrixFaultMenu) matrixFaultMenu.hidden = true;
    if (matrixFaultButton) matrixFaultButton.setAttribute("aria-expanded", "false");
    elements.faultFilterMenu.hidden = true;
    elements.faultFilterButton.setAttribute("aria-expanded", "false");
  });
  elements.faultSearch.addEventListener("input", renderFaults);
  elements.faultDateFilter.addEventListener("change", renderFaults);
  elements.faultSort.addEventListener("change", renderFaults);
  elements.faultFilterButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = elements.faultFilterMenu.hidden;
    elements.faultFilterMenu.hidden = !willOpen;
    elements.faultFilterButton.setAttribute("aria-expanded", String(willOpen));
  });
  elements.faultFilterMenu.addEventListener("click", (event) => event.stopPropagation());
  elements.faultFilterMenu.addEventListener("change", (event) => {
    const checkbox = event.target;
    if (!(checkbox instanceof HTMLInputElement)) return;
    if (checkbox === elements.faultFilterSelectAll) {
      const checked = checkbox.checked;
      state.selectedFaultStates.clear();
      state.selectedFaultEvents.clear();
      $$(".fault-option-checkbox").forEach((optionCheckbox) => {
        optionCheckbox.checked = checked;
        const collection = optionCheckbox.dataset.filterGroup === "state"
          ? state.selectedFaultStates
          : state.selectedFaultEvents;
        if (checked) collection.add(optionCheckbox.dataset.filterValue);
      });
    } else if (checkbox.classList.contains("fault-option-checkbox")) {
      const collection = checkbox.dataset.filterGroup === "state"
        ? state.selectedFaultStates
        : state.selectedFaultEvents;
      if (checkbox.checked) collection.add(checkbox.dataset.filterValue);
      else collection.delete(checkbox.dataset.filterValue);
    }
    updateFaultFilterControl();
    renderFaults();
  });
  document.addEventListener("click", (event) => {
    if (!elements.faultFilterContainer.contains(event.target)) {
      elements.faultFilterMenu.hidden = true;
      elements.faultFilterButton.setAttribute("aria-expanded", "false");
    }
    if (!elements.databaseFaultFilterMenu.contains(event.target) && event.target !== elements.databaseFaultFilterButton) {
      elements.databaseFaultFilterMenu.hidden = true;
      elements.databaseFaultFilterButton.setAttribute("aria-expanded", "false");
    }
    const matrixFaultMenu = elements.matrixFaultFilterMenu;
    const matrixFaultButton = $("#matrix-fault-filter-button");
    if (matrixFaultMenu && matrixFaultButton && !matrixFaultMenu.contains(event.target) && !matrixFaultButton.contains(event.target)) {
      matrixFaultMenu.hidden = true;
      matrixFaultButton.setAttribute("aria-expanded", "false");
    }
  });
  elements.populationSearch.addEventListener("input", renderPopulation);
  elements.eventSearch.addEventListener("input", renderEvents);
  elements.stateFilter.addEventListener("change", renderEvents);
  elements.eventDateFilter.addEventListener("change", renderEvents);
  elements.databaseLocomotiveSelect.addEventListener("change", () => {
    loadDatabaseLocomotive(elements.databaseLocomotiveSelect.value).catch((error) => {
      $("#database-result-note").textContent = `Database error: ${error.message}`;
    });
  });
  elements.databaseStateFilter.addEventListener("change", renderDatabaseEvents);
  elements.databaseSort.addEventListener("change", () => {
    state.databaseSortKey = "timestamp";
    state.databaseSortDirection = elements.databaseSort.value === "asc" ? "asc" : "desc";
    renderDatabaseEvents();
  });
  $$(".database-sort-button").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.databaseSort;
    if (state.databaseSortKey === key) {
      state.databaseSortDirection = state.databaseSortDirection === "asc" ? "desc" : "asc";
    } else {
      state.databaseSortKey = key;
      state.databaseSortDirection = key === "timestamp" ? "desc" : "asc";
    }
    if (state.databaseSortKey === "timestamp") elements.databaseSort.value = state.databaseSortDirection;
    renderDatabaseEvents();
  }));
  elements.databaseFaultFilterButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = elements.databaseFaultFilterMenu.hidden;
    elements.databaseFaultFilterMenu.hidden = !willOpen;
    elements.databaseFaultFilterButton.setAttribute("aria-expanded", String(willOpen));
  });
  elements.databaseFaultFilterMenu.addEventListener("click", (event) => event.stopPropagation());
  elements.databaseFaultFilterMenu.addEventListener("change", (event) => {
    const checkbox = event.target;
    if (!(checkbox instanceof HTMLInputElement)) return;
    if (checkbox === elements.databaseFaultSelectAll) {
      state.selectedDatabaseFaults.clear();
      $$(".database-fault-option").forEach((optionCheckbox) => {
        optionCheckbox.checked = checkbox.checked;
        if (checkbox.checked) state.selectedDatabaseFaults.add(optionCheckbox.dataset.faultIdentity);
      });
    } else if (checkbox.classList.contains("database-fault-option")) {
      if (checkbox.checked) state.selectedDatabaseFaults.add(checkbox.dataset.faultIdentity);
      else state.selectedDatabaseFaults.delete(checkbox.dataset.faultIdentity);
    }
    updateDatabaseFaultFilterControl();
    renderDatabaseEvents();
  });
  elements.databaseFromMonth.addEventListener("change", renderDatabaseEvents);
  elements.databaseToMonth.addEventListener("change", renderDatabaseEvents);
  $("#database-clear-period").addEventListener("click", () => {
    elements.databaseFromMonth.value = "";
    elements.databaseToMonth.value = "";
    renderDatabaseEvents();
  });
  elements.databaseSearch.addEventListener("input", renderDatabaseEvents);
  elements.databaseLocomotiveBody.addEventListener("click", (event) => {
    const target = event.target.closest("[data-locomotive]");
    if (!target) return;
    if (event.target.closest(".database-view-button")) {
      openLocomotiveDataPage(target.dataset.locomotive);
      return;
    }
    loadDatabaseLocomotive(target.dataset.locomotive).catch((error) => {
      $("#database-result-note").textContent = `Database error: ${error.message}`;
    });
  });
  elements.databaseLocomotiveBody.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target.closest("[data-locomotive]");
    if (!target) return;
    event.preventDefault();
    loadDatabaseLocomotive(target.dataset.locomotive).catch((error) => {
      $("#database-result-note").textContent = `Database error: ${error.message}`;
    });
  });
  $("#export-faults-excel").addEventListener("click", () => exportData("faults", "excel"));
  $("#export-faults-pdf").addEventListener("click", () => exportData("faults", "pdf"));
  $("#export-population-excel").addEventListener("click", () => exportData("population", "excel"));
  $("#export-population-pdf").addEventListener("click", () => exportData("population", "pdf"));
  $("#export-events-excel").addEventListener("click", () => exportData("events", "excel"));
  $("#export-events-pdf").addEventListener("click", () => exportData("events", "pdf"));
  $("#export-database-excel").addEventListener("click", () => exportDatabase("excel"));
  $("#export-database-pdf").addEventListener("click", () => exportDatabase("pdf"));
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => {
    switchTab(tab.dataset.tab);
    if (tab.dataset.tab === "database") {
      refreshDatabaseView().catch((error) => {
        $("#database-result-note").textContent = `Database error: ${error.message}`;
      });
    }
  }));
  setupFieldMap();
  restoreStoredSoftwareVersion();
  restoreStoredLoadingLogs();
  restoreStoredFaultLogs();
  FleetDatabase.openDatabase()
    .then(async () => {
      const summary = await FleetDatabase.getSummary();
      elements.headerDatabaseCount.textContent = summary.locomotiveCount.toLocaleString("en-IN");
      $("#database-tab-count").textContent = summary.locomotiveCount.toLocaleString("en-IN");
      const parameters = new URLSearchParams(window.location.search);
      const locomotiveNumber = parameters.get("locomotive");
      if (parameters.get("view") === "locomotive" && locomotiveNumber) {
        await openDedicatedLocomotivePage(locomotiveNumber);
      }
    })
    .catch(() => {
      elements.headerDatabaseButton.title = "The offline database is unavailable in this browser.";
      elements.headerViewLocoButton.title = "The offline database is unavailable in this browser.";
    });
})();
