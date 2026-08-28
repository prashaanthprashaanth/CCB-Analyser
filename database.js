(function createSharedFleetDatabase(root) {
  "use strict";

  const API_ROOT = "/api";
  const MAX_TIMESTAMP = 8640000000000000;

  async function apiRequest(path, options = {}) {
    let response;
    try {
      response = await fetch(`${API_ROOT}${path}`, {
        cache: "no-store",
        credentials: "same-origin",
        ...options,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {}),
        },
      });
    } catch (error) {
      throw new Error("The shared CCB server is unavailable. Open this page from the LAN server URL and check that the server is running.");
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      // The status-specific error below is clearer than a JSON parsing failure.
    }
    if (!response.ok) {
      throw new Error(payload?.error || `The shared database returned HTTP ${response.status}.`);
    }
    return payload;
  }

  function hydrateEvent(event) {
    const timestampMs = Number(event.timestampMs);
    return {
      ...event,
      timestampMs,
      occurrenceTimestampMs: event.occurrenceTimestampMs === null ? timestampMs : Number(event.occurrenceTimestampMs),
      clearedAtMs: event.clearedAtMs === null ? null : Number(event.clearedAtMs),
      durationMs: event.durationMs === null ? null : Number(event.durationMs),
      date: new Date(timestampMs),
    };
  }

  async function openDatabase() {
    return apiRequest("/health");
  }

  async function saveReports(entries) {
    const uploadEntries = entries.map(({ report, rawText }) => ({
      fileName: report?.fileName || "CCB report.txt",
      locomotiveNumber: report?.locomotiveNumber || "",
      locomotiveNumberSource: report?.locomotiveNumberSource || "",
      rawText: String(rawText || ""),
    }));
    return apiRequest("/reports", {
      method: "POST",
      body: JSON.stringify({ entries: uploadEntries }),
    });
  }

  async function getLocomotives() {
    const rows = await apiRequest("/locomotives");
    return rows.map((row) => ({
      ...row,
      firstTimestampMs: row.firstTimestampMs === null ? 0 : Number(row.firstTimestampMs),
      lastTimestampMs: row.lastTimestampMs === null ? 0 : Number(row.lastTimestampMs),
    }));
  }

  async function getReports(locomotiveNumber) {
    return apiRequest(`/reports?locomotive=${encodeURIComponent(String(locomotiveNumber))}`);
  }

  async function getEvents(locomotiveNumber, direction = "desc") {
    const rows = await apiRequest(`/events?locomotive=${encodeURIComponent(String(locomotiveNumber))}&direction=${direction === "asc" ? "asc" : "desc"}`);
    return rows.map(hydrateEvent);
  }

  async function getSummary() {
    const summary = await apiRequest("/summary");
    return {
      ...summary,
      firstTimestampMs: summary.firstTimestampMs === null ? MAX_TIMESTAMP : Number(summary.firstTimestampMs),
      lastTimestampMs: summary.lastTimestampMs === null ? 0 : Number(summary.lastTimestampMs),
    };
  }

  async function getFaultMatrix() {
    return apiRequest("/fault-matrix");
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
