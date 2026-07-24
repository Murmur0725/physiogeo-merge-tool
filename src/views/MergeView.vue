<script setup>
import { ref, reactive, computed } from "vue";
import FileDrop from "../components/FileDrop.vue";
import { runMergeWithBaseline, finalColumns, safeFilePart } from "../lib/merge";
import { archiveBaseline, isArchiveConfigured } from "../lib/archive";

const subjectId = ref("");
const subjectName = ref("");

const fileSpecs = [
  { key: "marks", label: "Mark CSV", accept: ".csv", color: "#22d3ee", hint: "备注需含 C/D（merge）与 A/B（baseline）" },
  { key: "rr", label: "RR CSV", accept: ".csv", color: "#4ade80", hint: "timestamp + rr_ms" },
  { key: "eeg", label: "EEG Excel", accept: ".xlsx,.xls", color: "#a78bfa", hint: "Date/日期, 时长, Time-set, EEG rows" },
  { key: "gpx", label: "GPS GPX", accept: ".gpx,.xml", color: "#facc15", hint: "trkpt lat/lon + time" },
  { key: "hr", label: "Heart Rate CSV", accept: ".csv,.CSV", color: "#f87171", hint: "Date, Start time, Time, HR (bpm)" }
];

const files = reactive({ marks: null, rr: null, eeg: null, gpx: null, hr: null });

const running = ref(false);
const rows = ref([]);
const csv = ref("");
const logs = ref(["Ready. 填写编号和姓名,上传 5 个文件后开始。网站仅导出 CD merge；AB baseline 后台入库，不可下载。"]);
const metrics = reactive({ rows: "--", gps: "--", rr: "--", eeg: "--", hr: "--" });
const rangeText = ref("");
const baselineStatus = ref("");

const PREVIEW_LIMIT = 80;

const canMerge = computed(
  () =>
    subjectId.value.trim() !== "" &&
    subjectName.value.trim() !== "" &&
    Object.values(files).every(Boolean)
);

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
    log(`Subject: ${id} ${name}`);
    log("截断窗口: C→D（网站 merge）；后台并行对齐 A→B（baseline，不可下载）");

    const { experiment, baseline } = await runMergeWithBaseline(files, log);

    // Only CD experiment merge is held for website preview/download.
    rows.value = experiment.rows;
    csv.value = experiment.csv;
    Object.assign(metrics, experiment.metrics);
    rangeText.value = `CD ${experiment.range}`;

    if (baseline) {
      log(`Baseline AB ready in memory (${baseline.metrics.rows} rows) — archiving privately…`);
      const archived = await archiveBaseline({
        subjectId: id,
        subjectName: name,
        csv: baseline.csv,
        metrics: baseline.metrics,
        range: baseline.range,
        windowLabel: baseline.label
      });
      baselineStatus.value = archived.reason;
      log(archived.ok ? `OK: ${archived.reason}` : `Baseline archive: ${archived.reason}`);
      if (!isArchiveConfigured()) {
        log("提示: 配置 VITE_SUPABASE_* 后，Generate 时会自动把 AB baseline 写入私有库。");
      }
    } else {
      baselineStatus.value = "未生成 baseline（Mark 缺少 A/B）";
    }

    log(`Done. 预览/下载仅为 CD merge（前 ${Math.min(PREVIEW_LIMIT, experiment.rows.length)} 行）。`);
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
        <h2><span class="dot" style="background: var(--rainbow)"></span>Subject 被试信息</h2>
        <label class="field">
          <span>编号 Subject ID</span>
          <input v-model="subjectId" type="text" placeholder="e.g. 001" autocomplete="off" />
        </label>
        <label class="field">
          <span>姓名 Name</span>
          <input v-model="subjectName" type="text" placeholder="e.g. 张三" autocomplete="off" />
        </label>
        <p class="hint">下载仅为 CD 实验段：编号姓名-merge.csv（不含 baseline）</p>
      </section>

      <section class="card">
        <h2>Input Files 数据文件</h2>
        <FileDrop
          v-for="spec in fileSpecs"
          :key="spec.key"
          v-bind="spec"
          :file="files[spec.key]"
          @select="(f) => (files[spec.key] = f)"
        />
        <p class="hint">解析在浏览器本地完成。CD merge 可下载；AB baseline 仅后台入库，网站无下载入口。</p>
      </section>

      <div class="actions">
        <button class="btn btn-primary" :disabled="!canMerge || running" @click="generate">
          {{ running ? "Processing…" : "Generate Merge CSV" }}
        </button>
        <button class="btn btn-ghost" :disabled="!csv" @click="download">Download CD Merge</button>
      </div>
      <p v-if="baselineStatus" class="hint gate-hint">{{ baselineStatus }}</p>
      <p v-if="!canMerge" class="hint gate-hint">填写编号、姓名并上传全部 5 个文件后可生成</p>
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
          <h2>Preview 预览</h2>
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
          <p>生成后在这里预览合并数据(前 {{ PREVIEW_LIMIT }} 行)</p>
        </div>
      </section>

      <section class="card panel">
        <header class="panel-head">
          <h2>Processing Log 日志</h2>
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
