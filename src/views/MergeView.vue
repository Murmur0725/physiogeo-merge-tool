<script setup>
import { ref, reactive, computed } from "vue";
import FileDrop from "../components/FileDrop.vue";
import {
  runMergeWithBaseline,
  finalColumns,
  safeFilePart,
  EEG_TIMEZONE_OPTIONS
} from "../lib/merge";
import { archiveSession, isArchiveConfigured } from "../lib/archive";

const subjectId = ref("");
const subjectName = ref("");
/** EEG Date/日期 clock: chicago = convert Asia/Shanghai → America/Chicago; beijing = as-is */
const eegTimezone = ref("chicago");

/** marks = C/D from Mark CSV; manual = typed start/end timestamps */
const windowMode = ref("marks");
/** Manual CD = experiment cut window */
const manualStart = ref("");
const manualEnd = ref("");
/** Manual AB = baseline cut window (optional) */
const manualBaselineStart = ref("");
const manualBaselineEnd = ref("");

const fileSpecs = [
  { key: "marks", label: "Mark CSV", accept: ".csv", color: "#22d3ee", hint: "C/D = experiment; A/B = baseline" },
  { key: "rr", label: "RR CSV", accept: ".csv", color: "#4ade80", hint: "Optional · timestamp + rr_ms" },
  { key: "eeg", label: "EEG Excel", accept: ".xlsx,.xls", color: "#a78bfa", hint: "Optional · Date, duration, Time-set, EEG rows" },
  { key: "gpx", label: "GPS GPX", accept: ".gpx,.xml", color: "#facc15", hint: "Optional · trkpt lat/lon + time" },
  { key: "hr", label: "Heart Rate CSV", accept: ".csv,.CSV", color: "#f87171", hint: "Optional · Date, Start time, Time, HR (bpm)" }
];

const files = reactive({ marks: null, rr: null, eeg: null, gpx: null, hr: null });

const running = ref(false);
const rows = ref([]);
const csv = ref("");
const logs = ref([
  "Ready. Choose Mark CSV or Manual time. CD = experiment download; AB = baseline archive. Sensors optional."
]);
const metrics = reactive({ rows: "--", gps: "--", rr: "--", eeg: "--", hr: "--" });
const rangeText = ref("");
const baselineStatus = ref("");

const PREVIEW_LIMIT = 80;

const visibleFileSpecs = computed(() => {
  if (windowMode.value === "manual") {
    return fileSpecs.map((spec) =>
      spec.key === "marks"
        ? { ...spec, hint: "Optional · event notes inside the manual windows" }
        : spec
    );
  }
  return fileSpecs.map((spec) =>
    spec.key === "marks" ? { ...spec, hint: `Required · ${spec.hint}` } : spec
  );
});

const canMerge = computed(() => {
  if (subjectId.value.trim() === "" || subjectName.value.trim() === "") return false;
  if (windowMode.value === "manual") {
    return manualStart.value.trim() !== "" && manualEnd.value.trim() !== "";
  }
  return Boolean(files.marks);
});

const gateHint = computed(() => {
  if (subjectId.value.trim() === "" || subjectName.value.trim() === "") {
    return "Enter equipment ID and name.";
  }
  if (windowMode.value === "manual") {
    return "Enter C (start) and D (end) for the experiment window. A/B baseline is optional.";
  }
  return "Upload Mark CSV (C/D experiment; A/B baseline).";
});

const previewRows = computed(() => rows.value.slice(0, PREVIEW_LIMIT));

const metricList = computed(() => [
  { label: "Rows", value: metrics.rows },
  { label: "GPS", value: metrics.gps },
  { label: "RR", value: metrics.rr },
  { label: "EEG", value: metrics.eeg },
  { label: "HR", value: metrics.hr }
]);

function log(message) {
  logs.value.push(message);
}

function setWindowMode(mode) {
  windowMode.value = mode;
}

async function generate() {
  logs.value = ["Processing…"];
  csv.value = "";
  rows.value = [];
  rangeText.value = "";
  baselineStatus.value = "";
  running.value = true;
  try {
    const id = subjectId.value.trim();
    const name = subjectName.value.trim();
    log(`Equipment: ${id} ${name}`);
    log(
      `Route timezone: ${EEG_TIMEZONE_OPTIONS[eegTimezone.value]?.label || eegTimezone.value}`
    );

    const mergeOptions = {
      eegTimezone: eegTimezone.value
    };

    if (windowMode.value === "manual") {
      mergeOptions.manualWindow = {
        start: manualStart.value.trim(),
        end: manualEnd.value.trim()
      };
      const a = manualBaselineStart.value.trim();
      const b = manualBaselineEnd.value.trim();
      if (a || b) {
        mergeOptions.manualBaselineWindow = { start: a, end: b };
      }
      log(
        `Window mode: Manual · CD experiment ${mergeOptions.manualWindow.start} → ${mergeOptions.manualWindow.end}`
      );
      if (a && b) {
        log(`Window mode: Manual · AB baseline ${a} → ${b}`);
      } else {
        log("Window mode: Manual · AB baseline not set (optional; or use Mark A/B if uploaded).");
      }
    } else {
      log("Window mode: Mark CSV (C→D experiment; A→B baseline if present).");
    }

    const { experiment, baseline } = await runMergeWithBaseline(files, log, mergeOptions);

    // Only CD experiment merge is held for website preview/download.
    rows.value = experiment.rows;
    csv.value = experiment.csv;
    Object.assign(metrics, experiment.metrics);
    rangeText.value = `${experiment.label || "CD"} ${experiment.range}`;

    log("Archiving available CD / AB / raw files to private DB…");
    const archived = await archiveSession({
      subjectId: id,
      subjectName: name,
      experiment,
      baseline,
      files
    });
    baselineStatus.value = archived.reason;
    log(archived.ok ? `OK: ${archived.reason}` : `Archive: ${archived.reason}`);
    if (archived.experiment) log(`  · CD: ${archived.experiment.reason || (archived.experiment.ok ? "ok" : "fail")}`);
    if (archived.baseline) log(`  · AB: ${archived.baseline.reason || (archived.baseline.ok ? "ok" : "fail")}`);
    if (archived.raw) log(`  · raw: ${archived.raw.reason}`);
    if (!isArchiveConfigured()) {
      log("Tip: set VITE_SUPABASE_* and run 002_expand_archive_kinds.sql to enable archiving.");
    }

    log(`Done. Preview/download is CD merge only (first ${Math.min(PREVIEW_LIMIT, experiment.rows.length)} rows).`);
  } catch (error) {
    log(`ERROR: ${error.message}`);
  } finally {
    running.value = false;
  }
}

function download() {
  // Intentionally downloads CD experiment merge only — never baseline AB.
  if (!csv.value) return;
  const blob = new Blob([csv.value], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFilePart(subjectId.value.trim())}${safeFilePart(subjectName.value.trim())}-merge.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="merge-layout">
    <aside class="side">
      <section class="card">
        <h2><span class="dot" style="background: var(--rainbow)"></span>Equipment</h2>
        <label class="field">
          <span>Equipment ID</span>
          <input v-model="subjectId" type="text" placeholder="e.g. 001" autocomplete="off" />
        </label>
        <label class="field">
          <span>Name</span>
          <input v-model="subjectName" type="text" placeholder="e.g. Alex" autocomplete="off" />
        </label>
        <label class="field">
          <span>Route timezone</span>
          <select v-model="eegTimezone">
            <option value="chicago">Chicago</option>
            <option value="beijing">Beijing</option>
          </select>
        </label>
      </section>

      <section class="card">
        <h2>Cut window</h2>
        <div class="mode-toggle" role="group" aria-label="Cut window mode">
          <button
            type="button"
            class="mode-btn"
            :class="{ active: windowMode === 'marks' }"
            @click="setWindowMode('marks')"
          >
            Mark CSV
          </button>
          <button
            type="button"
            class="mode-btn"
            :class="{ active: windowMode === 'manual' }"
            @click="setWindowMode('manual')"
          >
            Manual time
          </button>
        </div>

        <div v-if="windowMode === 'manual'" class="manual-fields">
          <p class="manual-section-label">CD · Experiment (download)</p>
          <label class="field">
            <span>C · Start</span>
            <input
              v-model="manualStart"
              type="text"
              placeholder="2026-08-05 17:31:57"
              autocomplete="off"
            />
          </label>
          <label class="field">
            <span>D · End</span>
            <input
              v-model="manualEnd"
              type="text"
              placeholder="2026-08-05 17:50:05"
              autocomplete="off"
            />
          </label>

          <p class="manual-section-label">AB · Baseline (archive, optional)</p>
          <label class="field">
            <span>A · Baseline start</span>
            <input
              v-model="manualBaselineStart"
              type="text"
              placeholder="2026-08-05 17:08:39"
              autocomplete="off"
            />
          </label>
          <label class="field">
            <span>B · Baseline end</span>
            <input
              v-model="manualBaselineEnd"
              type="text"
              placeholder="2026-08-05 17:13:43"
              autocomplete="off"
            />
          </label>
          <p class="hint">
            Format: YYYY-MM-DD HH:mm:ss. CD is required for download; A/B both filled enables baseline archive. Mark CSV optional for event notes.
          </p>
        </div>
        <p v-else class="hint">
          Uses C→D for experiment and A→B for baseline from Mark CSV. Switch to Manual time to type CD / AB windows.
        </p>
      </section>

      <section class="card">
        <h2>Input Files</h2>
        <FileDrop
          v-for="spec in visibleFileSpecs"
          :key="spec.key"
          v-bind="spec"
          :file="files[spec.key]"
          @select="(f) => (files[spec.key] = f)"
        />
        <p class="hint">
          Missing RR / EEG / GPX / HR leave blank columns. CD download stays local; available files archive privately.
        </p>
      </section>

      <div class="actions">
        <button class="btn btn-primary" :disabled="!canMerge || running" @click="generate">
          {{ running ? "Processing…" : "Generate Merge CSV" }}
        </button>
        <button class="btn btn-ghost" :disabled="!csv" @click="download">Download Merge</button>
      </div>
      <p v-if="baselineStatus" class="hint gate-hint">{{ baselineStatus }}</p>
      <p v-if="!canMerge" class="hint gate-hint">{{ gateHint }}</p>
    </aside>

    <main class="main">
      <div class="metrics">
        <div v-for="m in metricList" :key="m.label" class="metric">
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
        </div>
      </div>

      <section class="card panel">
        <header class="panel-head">
          <h2>Preview</h2>
          <span v-if="rangeText" class="range">{{ rangeText }}</span>
        </header>
        <div v-if="rows.length" class="table-wrap">
          <table>
            <thead>
              <tr>
                <th v-for="c in finalColumns" :key="c">{{ c }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in previewRows" :key="i">
                <td v-for="c in finalColumns" :key="c" :class="{ empty: row[c] === '' }">
                  {{ row[c] === "" ? "·" : row[c] }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty-state">
          <div class="empty-orb"></div>
          <p>Merged data preview appears here after generate (first {{ PREVIEW_LIMIT }} rows).</p>
        </div>
      </section>

      <section class="card panel">
        <header class="panel-head">
          <h2>Processing Log</h2>
        </header>
        <pre class="log">{{ logs.join("\n") }}</pre>
      </section>
    </main>
  </div>
</template>

<style scoped>
.merge-layout {
  flex: 1;
  display: grid;
  grid-template-columns: 330px minmax(0, 1fr);
  gap: 20px;
  padding: 20px 24px 28px;
  max-width: 1560px;
  width: 100%;
  margin: 0 auto;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-self: start;
  position: sticky;
  top: 78px;
}

.mode-toggle {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 12px;
  padding: 4px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
}

.mode-btn {
  height: 34px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 12.5px;
  font-weight: 650;
  cursor: pointer;
}

.mode-btn.active {
  background: rgba(34, 211, 238, 0.16);
  color: #a5f3fc;
  box-shadow: inset 0 0 0 1px rgba(34, 211, 238, 0.35);
}

.manual-fields {
  display: grid;
  gap: 10px;
}

.manual-section-label {
  margin: 4px 0 0;
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--muted);
}

.manual-section-label:first-child {
  margin-top: 0;
}

.actions {
  display: grid;
  gap: 10px;
}

.gate-hint {
  text-align: center;
}

.main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(110px, 1fr));
  gap: 12px;
}

.panel {
  padding: 0;
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
}

.panel-head h2 {
  margin: 0;
}

.range {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--muted);
}

.empty-state {
  display: grid;
  place-items: center;
  gap: 14px;
  padding: 56px 20px;
  color: var(--faint);
  font-size: 13px;
}

.empty-orb {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: var(--rainbow);
  opacity: 0.35;
  filter: blur(1px);
}

@media (max-width: 1024px) {
  .merge-layout {
    grid-template-columns: 1fr;
  }

  .side {
    position: static;
  }

  .metrics {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 560px) {
  .metrics {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
