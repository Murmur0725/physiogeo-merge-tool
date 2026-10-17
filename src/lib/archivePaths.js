import { safeFilePart } from "./merge.js";

export function archiveStorageKey(subjectId, subjectName, identity = {}) {
  const subject = `${safeFilePart(subjectId)}-${safeFilePart(subjectName)}`;
  if (identity.version !== "v2") return subject;
  if (!identity.sessionId) throw new Error("V2 archive requires a session ID.");
  return `${subject}-v2-${safeFilePart(identity.sessionId)}`;
}

export function rawSlots(identity = {}) {
  return identity.version === "v2" ? [
    { key: "zip", label: "session", fallbackExt: ".zip" },
    { key: "eeg", label: "eeg", fallbackExt: ".csv" }
  ] : [
    { key: "marks", label: "marks", fallbackExt: ".csv" },
    { key: "rr", label: "rr", fallbackExt: ".csv" },
    { key: "eeg", label: "eeg", fallbackExt: ".xlsx" },
    { key: "gpx", label: "gpx", fallbackExt: ".gpx" },
    { key: "hr", label: "hr", fallbackExt: ".csv" }
  ];
}
