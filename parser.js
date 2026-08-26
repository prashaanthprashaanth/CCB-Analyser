(function attachParser(root) {
  "use strict";

  const SENSOR_FIELDS = [
    ["mrt", "MRT"],
    ["bpt", "BPT"],
    ["bpAlt", "BPalt"],
    ["ert", "ERT"],
    ["twentyTl", "20TL"],
    ["twentyTt", "20TT"],
    ["tenT", "10T"],
    ["bct", "BCT"],
    ["flt", "FLT"],
    ["rawA2d", "Raw A2D"],
    ["target", "Trgt"],
    ["aw4Pressure", "AW4 Press"],
  ];
  const PRESSURE_SENSOR_FIELDS = SENSOR_FIELDS.slice(0, 9);
  const PSI_TO_KG_CM2 = 0.0703069579;

  function scalePressureValue(rawValue) {
    const text = String(rawValue ?? "").trim();
    if (!text || /^(?:N\/?A|NOT\s*AVAILABLE)$/i.test(text)) {
      return { raw: text, psi: null, kgCm2: null, display: "Not Available" };
    }
    const rawNumber = Number(text);
    if (!Number.isFinite(rawNumber)) {
      return { raw: text, psi: null, kgCm2: null, display: "Not Available" };
    }
    const psi = rawNumber / 10;
    const kgCm2 = psi * PSI_TO_KG_CM2;
    return { raw: text, psi, kgCm2, display: kgCm2.toFixed(2) };
  }

  function parseTimestamp(value) {
    const match = String(value || "").trim().match(
      /^(\d{1,2}):(\d{1,2}):(\d{4})::(\d{1,2}):(\d{2}):(\d{2})$/,
    );
    if (!match) return null;

    const [, monthText, dayText, yearText, hourText, minuteText, secondText] = match;
    const month = Number(monthText);
    const day = Number(dayText);
    const year = Number(yearText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const date = new Date(year, month - 1, day, hour, minute, second);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day ||
      date.getHours() !== hour ||
      date.getMinutes() !== minute ||
      date.getSeconds() !== second
    ) {
      return null;
    }

    return {
      date,
      timestampMs: date.getTime(),
      dateKey: `${yearText}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    };
  }

  function splitTabRow(line) {
    const parts = String(line).split("\t").map((value) => value.trim());
    while (parts.length && !parts[parts.length - 1]) parts.pop();
    return parts;
  }

  function episodeKey(event) {
    return `${event.eventCode}\u241f${event.description.toLocaleLowerCase()}`;
  }

  function pairFaultEpisodes(events) {
    const openFailures = new Map();
    const episodes = [];

    for (const event of events) {
      const state = event.state.toLocaleLowerCase();
      const key = episodeKey(event);

      if (state === "fail") {
        const episode = {
          id: `fault-${event.originalIndex}`,
          failedEvent: event,
          clearedEvent: null,
          durationMs: null,
          status: "Unresolved",
        };
        episodes.push(episode);
        if (!openFailures.has(key)) openFailures.set(key, []);
        openFailures.get(key).push(episode);
      } else if (state === "pass") {
        const waiting = openFailures.get(key);
        if (waiting && waiting.length) {
          const episode = waiting.shift();
          episode.clearedEvent = event;
          episode.durationMs = Math.max(0, event.timestampMs - episode.failedEvent.timestampMs);
          episode.status = "Cleared";
        }
      }
    }

    return episodes;
  }

  function parseLoadingLog(lines) {
    const loadingIndex = lines.findIndex((line) => /^\s*Loading Log\s*$/i.test(line));
    if (loadingIndex < 0) return [];
    const endIndex = lines.findIndex(
      (line, index) => index > loadingIndex && /^\s*Run Time Data\s*$/i.test(line),
    );
    const section = lines.slice(loadingIndex + 1, endIndex > loadingIndex ? endIndex : lines.length);
    const records = [];

    for (let index = 0; index < section.length; index += 1) {
      const line = section[index].trim();
      if (!line || /^=+$/.test(line) || /^Num\b/i.test(line)) continue;
      let number;
      let dateRaw;
      let timeRaw;
      let userId;
      let fileName;
      const tabParts = section[index].split("\t").map((value) => value.trim()).filter(Boolean);

      if (tabParts.length >= 5 && /^\d+$/.test(tabParts[0])) {
        [number, dateRaw, timeRaw, userId] = tabParts;
        fileName = tabParts.slice(4).join(" ");
      } else {
        const match = line.match(
          /^(\d+)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))\s+(\S+)\s+(.+)$/i,
        );
        if (!match) continue;
        [, number, dateRaw, timeRaw, userId, fileName] = match;
      }

      const dateMatch = dateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      const timeMatch = timeRaw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
      let timestampMs = null;
      if (dateMatch && timeMatch) {
        const month = Number(dateMatch[1]);
        const day = Number(dateMatch[2]);
        const shortYear = Number(dateMatch[3]);
        const year = dateMatch[3].length === 2 ? (shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear) : shortYear;
        let hour = Number(timeMatch[1]) % 12;
        if (timeMatch[4].toUpperCase() === "PM") hour += 12;
        const installedAt = new Date(year, month - 1, day, hour, Number(timeMatch[2]), Number(timeMatch[3] || 0));
        if (!Number.isNaN(installedAt.getTime())) timestampMs = installedAt.getTime();
      }

      const versionMatch = fileName.match(/^(.+?)_RCPH/i);
      records.push({
        number: Number(number),
        dateRaw,
        timeRaw: timeRaw.replace(/\s+/g, " ").toUpperCase(),
        userId,
        fileName,
        softwareVersion: versionMatch ? versionMatch[1] : fileName.replace(/\.[^.]+$/, ""),
        timestampMs,
        originalIndex: index,
      });
    }

    return records.sort((a, b) =>
      (a.timestampMs ?? Number.MAX_SAFE_INTEGER) - (b.timestampMs ?? Number.MAX_SAFE_INTEGER) ||
      a.originalIndex - b.originalIndex,
    );
  }

  function parseStoredFaultLog(lines) {
    const faultLogIndex = lines.findIndex((line) => /^\s*Fault Log Data\s*$/i.test(line));
    if (faultLogIndex < 0) return [];
    const endIndex = lines.findIndex(
      (line, index) => index > faultLogIndex && /^\s*Event Log Data\s*$/i.test(line),
    );
    const section = lines.slice(faultLogIndex + 1, endIndex > faultLogIndex ? endIndex : lines.length);
    const records = [];

    for (let index = 0; index < section.length; index += 1) {
      const parts = splitTabRow(section[index]);
      if (parts.length < 5 || !/^\d+$/.test(parts[1]) || /^Failure Count$/i.test(parts[1])) continue;
      const description = parts.slice(4).join(" ").trim();
      if (!description) continue;
      const lastFailed = parseTimestamp(parts[2]);
      const lastCleared = parseTimestamp(parts[3]);
      const codeMatch = description.match(/F\/C\s*\[(\d+)\]/i);
      records.push({
        currentStatus: parts[0] || "Not reported",
        failureCount: Number(parts[1]),
        timeLastFailedRaw: parts[2],
        timeLastClearedRaw: parts[3],
        timeLastFailedMs: lastFailed?.timestampMs ?? null,
        timeLastClearedMs: lastCleared?.timestampMs ?? null,
        faultCode: codeMatch ? codeMatch[1] : "",
        description,
        originalIndex: index,
      });
    }
    return records;
  }

  function parseEventLog(text, fileName) {
    const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
    const sectionIndex = lines.findIndex((line) => /^\s*Event Log Data\s*$/i.test(line));
    if (sectionIndex < 0) {
      throw new Error('The file does not contain an "Event Log Data" section.');
    }

    const headerIndex = lines.findIndex(
      (line, index) => index > sectionIndex && /Time Stamp/i.test(line) && /Description/i.test(line),
    );
    if (headerIndex < 0) {
      throw new Error("The Event Log column header could not be found.");
    }

    const softwareVersion = lines.slice(0, sectionIndex).map((line) => line.trim()).find(Boolean) || "Unknown";
    const textLocomotiveNumber = lines
      .filter((line) => /^\s*(?:Locomotive|Loco)\s*(?:Number|No\.?|#)\s*:/i.test(line))
      .map((line) => line.match(/:\s*([A-Z0-9\/-]+)/i))
      .filter(Boolean)
      .map((match) => match[1])
      .find((value) => !/^(?:N\/?A|NA|NONE|UNKNOWN)$/i.test(value)) || null;
    const fileLocomotiveMatch = String(fileName || "").match(/^\s*([A-Z0-9-]{4,12})\b/i);
    const events = [];
    let malformedRows = 0;

    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const parts = splitTabRow(lines[index]);
      if (!parts.length || !/^\d{1,3}$/.test(parts[0])) continue;
      if (parts.length < 18) {
        malformedRows += 1;
        continue;
      }

      const timestamp = parseTimestamp(parts[15]);
      if (!timestamp) {
        malformedRows += 1;
        continue;
      }

      const event = {
        record: parts[0].padStart(3, "0"),
        mrt: parts[1],
        bpt: parts[2],
        bpAlt: parts[3],
        ert: parts[4],
        twentyTl: parts[5],
        twentyTt: parts[6],
        tenT: parts[7],
        bct: parts[8],
        flt: parts[9],
        rawA2d: parts[10],
        target: parts[11],
        aw4Pressure: parts[12],
        mode: parts[13],
        state: parts[14],
        timestampRaw: parts[15],
        eventCode: parts[16],
        description: parts.slice(17).join(" ").trim(),
        ...timestamp,
        originalIndex: index,
      };
      event.pressureValues = Object.fromEntries(
        PRESSURE_SENSOR_FIELDS.map(([field]) => [field, scalePressureValue(event[field])]),
      );
      events.push(event);
    }

    if (!events.length) {
      throw new Error("No valid Event Log rows were found below the header.");
    }

    events.sort((a, b) => a.timestampMs - b.timestampMs || a.originalIndex - b.originalIndex);
    const faultEpisodes = pairFaultEpisodes(events);
    const loadingLog = parseLoadingLog(lines);
    const storedFaultLog = parseStoredFaultLog(lines);
    const faultDates = new Set(faultEpisodes.map((episode) => episode.failedEvent.dateKey));
    const clearedCount = faultEpisodes.filter((episode) => episode.clearedEvent).length;

    return {
      fileName: fileName || "CCB report.txt",
      reportId: softwareVersion,
      softwareVersion,
      locomotiveNumber: textLocomotiveNumber || (fileLocomotiveMatch ? fileLocomotiveMatch[1] : null),
      locomotiveNumberSource: textLocomotiveNumber ? "report" : (fileLocomotiveMatch ? "filename" : null),
      events,
      faultEpisodes,
      loadingLog,
      storedFaultLog,
      malformedRows,
      summary: {
        eventCount: events.length,
        faultCount: faultEpisodes.length,
        faultDateCount: faultDates.size,
        clearedCount,
        unresolvedCount: faultEpisodes.length - clearedCount,
        firstEvent: events[0],
        lastEvent: events[events.length - 1],
      },
    };
  }

  const api = {
    SENSOR_FIELDS,
    PRESSURE_SENSOR_FIELDS,
    PSI_TO_KG_CM2,
    scalePressureValue,
    parseTimestamp,
    parseEventLog,
    pairFaultEpisodes,
    parseLoadingLog,
    parseStoredFaultLog,
  };
  root.CCBParser = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
