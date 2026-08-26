(function createFleetDatabase(root) {
  "use strict";

  const DATABASE_NAME = "ccb-fleet-fault-database";
  const DATABASE_VERSION = 3;
  const DATE_TIME_IDENTITY_VERSION = 2;
  const MAX_TIMESTAMP = 8640000000000000;
  let connectionPromise = null;
  let identityMigrationPromise = null;

  function normalizeEventIdentity(eventCode) {
    return String(eventCode ?? "").trim().toLocaleUpperCase() || "UNKNOWN";
  }

  function eventDedupeKey(event) {
    return `${event.occurrenceTimestampMs}\u241f${event.eventIdentity}\u241f${event.stateLower}`;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Database request failed."));
    });
  }

  function transactionComplete(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Database transaction failed."));
      transaction.onabort = () => reject(transaction.error || new Error("Database transaction was cancelled."));
    });
  }

  function openDatabase() {
    if (!("indexedDB" in root)) return Promise.reject(new Error("This browser does not support the offline fleet database."));
    if (connectionPromise) return connectionPromise;
    connectionPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("locomotives")) {
          database.createObjectStore("locomotives", { keyPath: "locomotiveNumber" });
        }
        let reports;
        if (!database.objectStoreNames.contains("reports")) {
          reports = database.createObjectStore("reports", { keyPath: "reportKey" });
          reports.createIndex("byLocomotive", "locomotiveNumber", { unique: false });
          reports.createIndex("byImportedAt", "importedAt", { unique: false });
        } else {
          reports = request.transaction.objectStore("reports");
        }
        if (!reports.indexNames.contains("byDateTimeIdentity")) {
          reports.createIndex("byDateTimeIdentity", "dateTimeIdentity", { unique: false });
        }
        let events;
        if (!database.objectStoreNames.contains("events")) {
          events = database.createObjectStore("events", {
            keyPath: ["locomotiveNumber", "timestampMs", "reportKey", "originalIndex"],
          });
          events.createIndex("byLocomotive", "locomotiveNumber", { unique: false });
          events.createIndex("byLocomotiveTime", ["locomotiveNumber", "timestampMs"], { unique: false });
          events.createIndex("byLocomotiveStateTime", ["locomotiveNumber", "stateLower", "timestampMs"], { unique: false });
          events.createIndex("byReport", "reportKey", { unique: false });
        } else {
          events = request.transaction.objectStore("events");
        }
        if (!events.indexNames.contains("byLocomotiveOccurrenceFaultState")) {
          events.createIndex(
            "byLocomotiveOccurrenceFaultState",
            ["locomotiveNumber", "occurrenceTimestampMs", "eventIdentity", "stateLower"],
            { unique: false },
          );
        }
        const cursorRequest = events.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const event = cursor.value;
          const eventIdentity = normalizeEventIdentity(event.eventCode);
          const stateLower = String(event.stateLower || event.state || "").toLocaleLowerCase();
          const occurrenceTimestampMs = Number.isFinite(event.occurrenceTimestampMs) ? event.occurrenceTimestampMs : event.timestampMs;
          if (event.eventIdentity !== eventIdentity || event.stateLower !== stateLower || event.occurrenceTimestampMs !== occurrenceTimestampMs) {
            cursor.update({ ...event, eventIdentity, stateLower, occurrenceTimestampMs });
          }
          cursor.continue();
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => {
        connectionPromise = null;
        reject(request.error || new Error("The offline fleet database could not be opened."));
      };
    });
    return connectionPromise;
  }

  async function hashText(value) {
    const bytes = new TextEncoder().encode(String(value));
    if (root.crypto?.subtle) {
      const digest = await root.crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    let hash = 2166136261;
    bytes.forEach((byte) => {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    });
    return `fallback-${(hash >>> 0).toString(16)}-${bytes.length}`;
  }

  function createReportRecord(reportKey, dateTimeIdentity, report, rawText, storedEvents, skippedDuplicateEventCount) {
    const failures = storedEvents.filter((event) => event.stateLower === "fail");
    const clearedCount = failures.filter((event) => event.clearedAtMs !== null).length;
    return {
      reportKey,
      dateTimeIdentity,
      dateTimeIdentityVersion: DATE_TIME_IDENTITY_VERSION,
      locomotiveNumber: String(report.locomotiveNumber),
      locomotiveNumberSource: report.locomotiveNumberSource || "unknown",
      fileName: report.fileName,
      softwareVersion: report.softwareVersion,
      importedAt: new Date().toISOString(),
      rawText,
      loadingLog: report.loadingLog || [],
      storedFaultLog: report.storedFaultLog || [],
      malformedRows: report.malformedRows || 0,
      sourceEventCount: report.summary.eventCount,
      skippedDuplicateEventCount,
      skippedExistingTimestampCount: skippedDuplicateEventCount,
      eventCount: storedEvents.length,
      faultCount: failures.length,
      clearedCount,
      unresolvedCount: failures.length - clearedCount,
      firstTimestampMs: Math.min(...storedEvents.map((event) => event.timestampMs)),
      lastTimestampMs: Math.max(...storedEvents.map((event) => event.timestampMs)),
    };
  }

  async function calculateDateTimeIdentity(locomotiveNumber, events) {
    const eventSequence = events
      .map((event) => `${event.occurrenceTimestampMs}:${normalizeEventIdentity(event.eventCode)}:${event.stateLower}`)
      .join("|");
    return hashText(`${locomotiveNumber}\n${eventSequence}`);
  }

  function applyFaultOccurrenceTimes(events) {
    const openFailures = new Map();
    const ordered = [...events].sort((left, right) => left.timestampMs - right.timestampMs || left.originalIndex - right.originalIndex);
    ordered.forEach((event) => {
      event.eventIdentity = normalizeEventIdentity(event.eventCode);
      event.stateLower = String(event.stateLower || event.state || "").toLocaleLowerCase();
      event.occurrenceTimestampMs = event.timestampMs;
      const faultKey = `${event.eventIdentity}\u241f${String(event.description || "").trim().toLocaleLowerCase()}`;
      if (event.stateLower === "fail") {
        if (!openFailures.has(faultKey)) openFailures.set(faultKey, []);
        openFailures.get(faultKey).push(event);
      } else if (event.stateLower === "pass") {
        const waiting = openFailures.get(faultKey);
        if (waiting?.length) event.occurrenceTimestampMs = waiting.shift().timestampMs;
      }
    });
    return events;
  }

  async function ensureReportDateTimeIdentities(database) {
    if (identityMigrationPromise) return identityMigrationPromise;
    identityMigrationPromise = (async () => {
      const readTransaction = database.transaction(["reports", "events"], "readonly");
      const reports = await requestResult(readTransaction.objectStore("reports").getAll());
      const legacyReports = reports.filter((report) => !report.dateTimeIdentity || report.dateTimeIdentityVersion !== DATE_TIME_IDENTITY_VERSION);
      for (const report of legacyReports) {
        const eventTransaction = database.transaction("events", "readwrite");
        const eventStore = eventTransaction.objectStore("events");
        const events = await requestResult(eventStore.index("byReport").getAll(report.reportKey));
        events.sort((left, right) => left.timestampMs - right.timestampMs || left.originalIndex - right.originalIndex);
        applyFaultOccurrenceTimes(events).forEach((event) => eventStore.put(event));
        await transactionComplete(eventTransaction);
        report.dateTimeIdentity = await calculateDateTimeIdentity(report.locomotiveNumber, events);
        report.dateTimeIdentityVersion = DATE_TIME_IDENTITY_VERSION;
        const updateTransaction = database.transaction("reports", "readwrite");
        updateTransaction.objectStore("reports").put(report);
        await transactionComplete(updateTransaction);
      }
    })().catch((error) => {
      identityMigrationPromise = null;
      throw error;
    });
    return identityMigrationPromise;
  }

  function createEventRecords(reportKey, report) {
    const episodes = new Map();
    report.faultEpisodes.forEach((episode) => {
      episodes.set(episode.failedEvent.originalIndex, episode);
      if (episode.clearedEvent) episodes.set(episode.clearedEvent.originalIndex, episode);
    });
    return report.events.map((event) => {
      const episode = episodes.get(event.originalIndex);
      const record = { ...event };
      delete record.date;
      const stateLower = event.state.toLocaleLowerCase();
      return {
        ...record,
        reportKey,
        locomotiveNumber: String(report.locomotiveNumber),
        softwareVersion: report.softwareVersion,
        sourceFile: report.fileName,
        stateLower,
        eventIdentity: normalizeEventIdentity(event.eventCode),
        occurrenceTimestampMs: episode?.failedEvent?.timestampMs ?? event.timestampMs,
        clearedAtMs: episode?.clearedEvent?.timestampMs ?? null,
        durationMs: episode?.durationMs ?? null,
        environmentParameters: {
          MRT: { raw: event.mrt, ...event.pressureValues?.mrt },
          BPT: { raw: event.bpt, ...event.pressureValues?.bpt },
          BPalt: { raw: event.bpAlt, ...event.pressureValues?.bpAlt },
          ERT: { raw: event.ert, ...event.pressureValues?.ert },
          "20TL": { raw: event.twentyTl, ...event.pressureValues?.twentyTl },
          "20TT": { raw: event.twentyTt, ...event.pressureValues?.twentyTt },
          "10T": { raw: event.tenT, ...event.pressureValues?.tenT },
          BCT: { raw: event.bct, ...event.pressureValues?.bct },
          FLT: { raw: event.flt, ...event.pressureValues?.flt },
        },
      };
    });
  }

  async function putReport(database, entry) {
    const report = entry.report;
    const rawText = String(entry.rawText || "");
    if (!report.locomotiveNumber) throw new Error(`${report.fileName}: locomotive number is missing.`);
    const reportKey = await hashText(`${report.locomotiveNumber}\n${rawText}`);
    const allEventRecords = createEventRecords(reportKey, report);
    const seenIncomingEvents = new Set();
    const uniqueEventRecords = allEventRecords.filter((event) => {
      const key = eventDedupeKey(event);
      if (seenIncomingEvents.has(key)) return false;
      seenIncomingEvents.add(key);
      return true;
    });
    const skippedWithinFileCount = allEventRecords.length - uniqueEventRecords.length;
    const dateTimeIdentity = await calculateDateTimeIdentity(report.locomotiveNumber, uniqueEventRecords);

    // Keep duplicate detection and insertion in one read/write transaction. IndexedDB
    // serializes transactions covering these stores, so two app windows cannot both
    // claim the same locomotive + fault occurrence second + event/state before either
    // one writes its events.
    const transaction = database.transaction(["reports", "events"], "readwrite");
    const completion = transactionComplete(transaction);
    const reportStore = transaction.objectStore("reports");
    const eventStore = transaction.objectStore("events");
    const eventIdentityIndex = eventStore.index("byLocomotiveOccurrenceFaultState");
    const duplicateRequest = requestResult(reportStore.index("byDateTimeIdentity").get(dateTimeIdentity));
    const eventRequests = uniqueEventRecords.map((event) => requestResult(eventIdentityIndex.getKey([
      String(report.locomotiveNumber),
      event.occurrenceTimestampMs,
      event.eventIdentity,
      event.stateLower,
    ])));
    const [duplicate, ...existingKeys] = await Promise.all([duplicateRequest, ...eventRequests]);

    if (duplicate) {
      await completion;
      return {
        status: "duplicate",
        reportKey: duplicate.reportKey,
        fileName: report.fileName,
        storedEventCount: 0,
        skippedDuplicateEventCount: report.events.length,
        skippedExistingTimestampCount: report.events.length,
      };
    }

    const storedEvents = uniqueEventRecords.filter((event, position) => existingKeys[position] === undefined);
    const skippedDuplicateEventCount = skippedWithinFileCount + uniqueEventRecords.length - storedEvents.length;
    if (!storedEvents.length) {
      await completion;
      return {
        status: "duplicate_overlap",
        reportKey: null,
        fileName: report.fileName,
        storedEventCount: 0,
        skippedDuplicateEventCount,
        skippedExistingTimestampCount: skippedDuplicateEventCount,
      };
    }
    reportStore.put(createReportRecord(reportKey, dateTimeIdentity, report, rawText, storedEvents, skippedDuplicateEventCount));
    storedEvents.forEach((event) => eventStore.put(event));
    await completion;
    return {
      status: "saved",
      reportKey,
      fileName: report.fileName,
      storedEventCount: storedEvents.length,
      skippedDuplicateEventCount,
      skippedExistingTimestampCount: skippedDuplicateEventCount,
    };
  }

  async function getAllFromStore(storeName) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readonly");
    return requestResult(transaction.objectStore(storeName).getAll());
  }

  async function rebuildLocomotiveSummaries(database) {
    const readTransaction = database.transaction("reports", "readonly");
    const reports = await requestResult(readTransaction.objectStore("reports").getAll());
    const summaries = new Map();
    reports.forEach((report) => {
      if (!summaries.has(report.locomotiveNumber)) {
        summaries.set(report.locomotiveNumber, {
          locomotiveNumber: report.locomotiveNumber,
          reportCount: 0,
          eventCount: 0,
          faultCount: 0,
          clearedCount: 0,
          firstTimestampMs: report.firstTimestampMs,
          lastTimestampMs: report.lastTimestampMs,
          lastImportedAt: report.importedAt,
          softwareVersions: [],
        });
      }
      const summary = summaries.get(report.locomotiveNumber);
      summary.reportCount += 1;
      summary.eventCount += report.eventCount;
      summary.faultCount += report.faultCount;
      summary.clearedCount += report.clearedCount;
      summary.firstTimestampMs = Math.min(summary.firstTimestampMs, report.firstTimestampMs);
      summary.lastTimestampMs = Math.max(summary.lastTimestampMs, report.lastTimestampMs);
      if (report.importedAt > summary.lastImportedAt) summary.lastImportedAt = report.importedAt;
      if (!summary.softwareVersions.includes(report.softwareVersion)) summary.softwareVersions.push(report.softwareVersion);
    });

    const writeTransaction = database.transaction("locomotives", "readwrite");
    const store = writeTransaction.objectStore("locomotives");
    store.clear();
    summaries.forEach((summary) => store.put(summary));
    await transactionComplete(writeTransaction);
  }

  async function saveReports(entries) {
    const database = await openDatabase();
    await ensureReportDateTimeIdentities(database);
    const results = [];
    for (const entry of entries) results.push(await putReport(database, entry));
    await rebuildLocomotiveSummaries(database);
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => { /* Persistence is best-effort. */ });
    }
    return {
      results,
      savedCount: results.filter((result) => result.status === "saved").length,
      duplicateCount: results.filter((result) => result.status === "duplicate" || result.status === "duplicate_overlap").length,
      skippedDuplicateEventCount: results.reduce((total, result) => total + (result.skippedDuplicateEventCount || 0), 0),
      // Retained for compatibility with older UI builds.
      skippedOverlapEventCount: results.reduce((total, result) => total + (result.skippedDuplicateEventCount || 0), 0),
      storedEventCount: results.reduce((total, result) => total + (result.storedEventCount || 0), 0),
      savedReportKeys: results.filter((result) => result.status === "saved").map((result) => result.reportKey),
    };
  }

  async function getLocomotives() {
    const rows = await getAllFromStore("locomotives");
    return rows.sort((a, b) => a.locomotiveNumber.localeCompare(b.locomotiveNumber, undefined, { numeric: true }));
  }

  async function getReports(locomotiveNumber) {
    const database = await openDatabase();
    const transaction = database.transaction("reports", "readonly");
    const rows = await requestResult(transaction.objectStore("reports").index("byLocomotive").getAll(String(locomotiveNumber)));
    return rows.sort((a, b) => a.firstTimestampMs - b.firstTimestampMs || a.fileName.localeCompare(b.fileName));
  }

  async function getEvents(locomotiveNumber, direction = "desc") {
    const database = await openDatabase();
    const transaction = database.transaction("events", "readonly");
    const range = IDBKeyRange.bound([String(locomotiveNumber), 0], [String(locomotiveNumber), MAX_TIMESTAMP]);
    const index = transaction.objectStore("events").index("byLocomotiveTime");
    const rows = await new Promise((resolve, reject) => {
      const values = [];
      const request = index.openCursor(range, direction === "asc" ? "next" : "prev");
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(values);
          return;
        }
        values.push(cursor.value);
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error("Stored events could not be retrieved."));
    });
    return rows.map((event) => ({ ...event, date: new Date(event.timestampMs) }));
  }

  async function getSummary() {
    const locomotives = await getLocomotives();
    return locomotives.reduce((summary, locomotive) => ({
      locomotiveCount: summary.locomotiveCount + 1,
      reportCount: summary.reportCount + locomotive.reportCount,
      eventCount: summary.eventCount + locomotive.eventCount,
      faultCount: summary.faultCount + locomotive.faultCount,
      clearedCount: summary.clearedCount + locomotive.clearedCount,
      firstTimestampMs: Math.min(summary.firstTimestampMs, locomotive.firstTimestampMs),
      lastTimestampMs: Math.max(summary.lastTimestampMs, locomotive.lastTimestampMs),
    }), {
      locomotiveCount: 0,
      reportCount: 0,
      eventCount: 0,
      faultCount: 0,
      clearedCount: 0,
      firstTimestampMs: MAX_TIMESTAMP,
      lastTimestampMs: 0,
    });
  }

  async function getFaultMatrix() {
    const events = await getAllFromStore("events");
    const locomotiveSet = new Set();
    const faultRows = new Map();

    events.forEach((event) => {
      const locomotiveNumber = String(event.locomotiveNumber || "").trim();
      if (locomotiveNumber) locomotiveSet.add(locomotiveNumber);
      if (!locomotiveNumber || String(event.stateLower || event.state || "").toLowerCase() !== "fail") return;

      const eventCode = String(event.eventCode ?? "").trim();
      const description = String(event.description || "Unknown fault").trim() || "Unknown fault";
      const identity = `${normalizeEventIdentity(eventCode)}\u241f${description.toLowerCase()}`;
      if (!faultRows.has(identity)) {
        faultRows.set(identity, {
          eventCode,
          faultName: description,
          counts: {},
          total: 0,
        });
      }
      const row = faultRows.get(identity);
      row.counts[locomotiveNumber] = (row.counts[locomotiveNumber] || 0) + 1;
      row.total += 1;
    });

    const locomotives = [...locomotiveSet]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const rows = [...faultRows.values()]
      .sort((a, b) => b.total - a.total
        || a.faultName.localeCompare(b.faultName)
        || a.eventCode.localeCompare(b.eventCode, undefined, { numeric: true }));
    return { locomotives, rows };
  }

  root.CCBDatabase = {
    openDatabase,
    saveReports,
    getLocomotives,
    getReports,
    getEvents,
    getSummary,
    getFaultMatrix,
  };
})(typeof window !== "undefined" ? window : globalThis);
