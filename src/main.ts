import "@picocss/pico/css/pico.min.css";
import "./styles/main.css";
import { APP_DATA_VERSION, type RecordItem, type RecordResult } from "./models/record";
import { createKstTimestamp, kstDate, kstTime, kstTimeParts, todayKst } from "./services/date";
import { calculateStatistics, displayNumber } from "./services/statistics";
import { exportRecords, importRecords } from "./services/transfer";
import { loadData, saveData } from "./storage/local-storage";

export type ResultFilter = "all" | "success" | "fail" | "unspecified";

const root = document.querySelector<HTMLElement>("#app") ?? missingRoot();

let records = loadData().records;
let selectedDate = todayKst();
let selectedResultFilter: ResultFilter = "all";

function missingRoot(): never { throw new Error("Application root is missing."); }

root.innerHTML = `
  <header class="app-header">
    <div><h1>기록 관리</h1></div>
    <div class="date-controls">
      <button class="secondary outline today-button" type="button" data-action="today">오늘</button>
      <input id="date-filter" type="date" aria-label="표시할 날짜" />
    </div>
  </header>
  <section class="filter-section" aria-label="결과 상태 필터">
    <div class="filter-bar" role="tablist">
      <button type="button" class="filter-tab active" data-action="filter-result" data-filter="all" role="tab" aria-selected="true">
        <span class="filter-label">전체</span>
        <span class="filter-count" id="count-all">0</span>
      </button>
      <button type="button" class="filter-tab filter-success" data-action="filter-result" data-filter="success" role="tab" aria-selected="false">
        <span class="filter-label">✓ 성공</span>
        <span class="filter-count" id="count-success">0</span>
      </button>
      <button type="button" class="filter-tab filter-fail" data-action="filter-result" data-filter="fail" role="tab" aria-selected="false">
        <span class="filter-label">✕ 실패</span>
        <span class="filter-count" id="count-fail">0</span>
      </button>
      <button type="button" class="filter-tab filter-unspecified" data-action="filter-result" data-filter="unspecified" role="tab" aria-selected="false">
        <span class="filter-label">미지정</span>
        <span class="filter-count" id="count-unspecified">0</span>
      </button>
    </div>
  </section>
  <section class="stats" aria-label="선택한 날짜의 통계">
    <div><strong>데이터</strong><span id="data-stat">0 GB · 0 MB</span></div>
    <div><strong>길이</strong><span id="length-stat">0 시간 · 0 초</span></div>
  </section>
  <p id="status" class="status" role="status" aria-live="polite"></p>
  <section class="records-section" aria-label="기록 목록">
    <div class="list-header">
      <h2>기록 목록</h2>
      <div class="list-actions" aria-label="기록 관리">
        <button type="button" class="secondary outline" data-action="open-export">내보내기</button>
        <button type="button" class="secondary outline" data-action="open-import">가져오기</button>
        <button type="button" class="danger-action" data-action="clear-all">전체 삭제</button>
      </div>
    </div>
    <div id="record-list" class="record-list"></div>
  </section>
  <dialog id="export-dialog" aria-labelledby="export-title">
    <article>
      <header>
        <h3 id="export-title">기록 내보내기</h3>
        <button type="button" class="close-button" data-action="close-dialog" aria-label="닫기">✕</button>
      </header>
      <p>선택한 날짜 및 조건의 기록을 압축했습니다. 문자열을 복사해 전달하세요.</p>
      <label for="export-text">전송 문자열</label>
      <textarea id="export-text" rows="5" readonly spellcheck="false"></textarea>
      <div id="export-feedback" class="dialog-feedback" role="status" aria-live="polite"></div>
      <footer><button type="button" class="copy-button" data-action="copy-export">문자열 복사</button></footer>
    </article>
  </dialog>
  <dialog id="import-dialog" aria-labelledby="import-title">
    <article>
      <header>
        <h3 id="import-title">기록 가져오기</h3>
        <button type="button" class="close-button" data-action="close-dialog" aria-label="닫기">✕</button>
      </header>
      <p>현재 선택 날짜의 기록만 기존 데이터에 병합합니다. 동일한 ID는 추가하지 않습니다.</p>
      <label for="import-text">전송 문자열</label>
      <textarea id="import-text" rows="5" spellcheck="false" placeholder="RT1:... 문자열을 붙여넣으세요"></textarea>
      <div id="import-feedback" class="dialog-feedback" role="status" aria-live="polite"></div>
      <footer><button type="button" data-action="import">가져오기 병합</button></footer>
    </article>
  </dialog>
  <dialog id="edit-time-dialog" aria-labelledby="edit-time-title">
    <article class="time-edit-modal">
      <header>
        <h3 id="edit-time-title">기록 시간 수정</h3>
        <button type="button" class="close-button" data-action="close-dialog" aria-label="닫기">✕</button>
      </header>
      <p class="time-edit-description">수정할 시간을 시, 분, 초 단위로 입력하세요.</p>
      <form id="edit-time-form" method="dialog" novalidate>
        <div class="time-inputs-wrapper">
          <div class="time-segment-field" id="field-hour">
            <input id="time-hour" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="00" aria-label="시 (00-23)" autocomplete="off" />
            <span class="time-segment-label">시</span>
          </div>
          <span class="time-colon" aria-hidden="true">:</span>
          <div class="time-segment-field" id="field-minute">
            <input id="time-minute" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="00" aria-label="분 (00-59)" autocomplete="off" />
            <span class="time-segment-label">분</span>
          </div>
          <span class="time-colon" aria-hidden="true">:</span>
          <div class="time-segment-field" id="field-second">
            <input id="time-second" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="00" aria-label="초 (00-59)" autocomplete="off" />
            <span class="time-segment-label">초</span>
          </div>
        </div>
        <div id="edit-time-feedback" class="dialog-feedback" role="alert" aria-live="polite"></div>
        <footer>
          <button type="button" class="secondary outline" data-action="close-dialog">취소</button>
          <button type="submit" class="primary" data-action="save-time">저장</button>
        </footer>
      </form>
    </article>
  </dialog>
  <div class="record-dock"><button id="add-record" type="button">기록</button></div>
`;

const list = required<HTMLElement>("#record-list");
const filter = required<HTMLInputElement>("#date-filter");
const dataStat = required<HTMLElement>("#data-stat");
const lengthStat = required<HTMLElement>("#length-stat");
const status = required<HTMLElement>("#status");

const exportDialog = required<HTMLDialogElement>("#export-dialog");
const importDialog = required<HTMLDialogElement>("#import-dialog");
const exportText = required<HTMLTextAreaElement>("#export-text");
const importText = required<HTMLTextAreaElement>("#import-text");
const exportFeedback = required<HTMLElement>("#export-feedback");
const importFeedback = required<HTMLElement>("#import-feedback");
const countAll = required<HTMLElement>("#count-all");
const countSuccess = required<HTMLElement>("#count-success");
const countFail = required<HTMLElement>("#count-fail");
const countUnspecified = required<HTMLElement>("#count-unspecified");

const editTimeDialog = required<HTMLDialogElement>("#edit-time-dialog");
const editTimeTitle = required<HTMLElement>("#edit-time-title");
const editTimeForm = required<HTMLFormElement>("#edit-time-form");
const timeHourInput = required<HTMLInputElement>("#time-hour");
const timeMinuteInput = required<HTMLInputElement>("#time-minute");
const timeSecondInput = required<HTMLInputElement>("#time-second");
const fieldHour = required<HTMLElement>("#field-hour");
const fieldMinute = required<HTMLElement>("#field-minute");
const fieldSecond = required<HTMLElement>("#field-second");
const editTimeFeedback = required<HTMLElement>("#edit-time-feedback");

let copyTimeoutId: number | null = null;
let editingRecordId: string | null = null;

function required<T extends Element>(selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing element: ${selector}`);
  return element;
}

let saveTimeoutId: number | null = null;
function persist(immediate = true): void {
  if (immediate) {
    if (saveTimeoutId !== null) {
      window.clearTimeout(saveTimeoutId);
      saveTimeoutId = null;
    }
    const success = saveData({ version: APP_DATA_VERSION, records });
    if (!success) setStatus("저장 공간이 부족하여 저장에 실패했습니다.", true);
  } else {
    if (saveTimeoutId !== null) window.clearTimeout(saveTimeoutId);
    saveTimeoutId = window.setTimeout(() => {
      saveTimeoutId = null;
      const success = saveData({ version: APP_DATA_VERSION, records });
      if (!success) setStatus("저장 공간이 부족하여 저장에 실패했습니다.", true);
    }, 300);
  }
}

function getDayRecords(): RecordItem[] {
  return records
    .filter((record) => kstDate(record.timestamp) === selectedDate)
    .sort((a, b) => b.timestamp - a.timestamp);
}

function getVisibleRecords(dayRecords: RecordItem[]): RecordItem[] {
  if (selectedResultFilter === "success") return dayRecords.filter((record) => record.result === "success");
  if (selectedResultFilter === "fail") return dayRecords.filter((record) => record.result === "fail");
  if (selectedResultFilter === "unspecified") return dayRecords.filter((record) => record.result === null);
  return dayRecords;
}

function setStatus(message = "", isError = false): void {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function numberValue(value: number | null): string { return value === null ? "" : String(value); }

function emptyMessage(dayTotal: number): string {
  if (dayTotal === 0) return "이 날짜에는 아직 기록이 없습니다.";
  if (selectedResultFilter === "success") return "성공으로 표시된 기록이 없습니다.";
  if (selectedResultFilter === "fail") return "실패로 표시된 기록이 없습니다.";
  if (selectedResultFilter === "unspecified") return "결과가 미지정된 기록이 없습니다.";
  return "표시할 기록이 없습니다.";
}

function recordTemplate(record: RecordItem, order: number): string {
  const success = record.result === "success";
  const fail = record.result === "fail";
  return `
    <article class="record-row" data-id="${record.id}">
      <div class="record-meta">
        <span class="record-order" aria-label="기록 번호 ${order}">${order}</span>
        <time datetime="${new Date(record.timestamp).toISOString()}">${kstTime(record.timestamp)}</time>
      </div>
      <div class="record-main">
        <div class="result-buttons" aria-label="${kstTime(record.timestamp)} 결과">
          <button type="button" class="result success ${success ? "selected" : ""}" data-action="result" data-result="success" aria-pressed="${success}">${success ? "✓ 성공" : "성공"}</button>
          <button type="button" class="result fail ${fail ? "selected" : ""}" data-action="result" data-result="fail" aria-pressed="${fail}">${fail ? "✓ 실패" : "실패"}</button>
        </div>
        <div class="metrics-fields">
          <label class="inline-field data-field">데이터 <input type="number" min="0" step="any" inputmode="decimal" aria-label="Data MB" data-field="dataMb" value="${numberValue(record.dataMb)}" /> <span>MB</span></label>
          <label class="inline-field length-field">길이 <input type="number" min="0" step="1" inputmode="numeric" aria-label="Length seconds" data-field="lengthSeconds" value="${numberValue(record.lengthSeconds)}" /> <span>초</span></label>
        </div>
      </div>
      <button type="button" class="delete-button" data-action="delete" aria-label="${kstTime(record.timestamp)} 기록 삭제" title="기록 삭제">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      </button>
    </article>`;
}

function updateFilterTabs(dayStats: ReturnType<typeof calculateStatistics>): void {
  countAll.textContent = String(dayStats.totalCount);
  countSuccess.textContent = String(dayStats.successCount);
  countFail.textContent = String(dayStats.failCount);
  countUnspecified.textContent = String(dayStats.unspecifiedCount);

  root.querySelectorAll<HTMLButtonElement>(".filter-tab").forEach((tab) => {
    const tabFilter = tab.dataset.filter;
    const isSelected = tabFilter === selectedResultFilter;
    tab.classList.toggle("active", isSelected);
    tab.setAttribute("aria-selected", isSelected ? "true" : "false");
  });
}

function refreshStatistics(stats: ReturnType<typeof calculateStatistics>): void {
  dataStat.textContent = `${displayNumber(stats.totalMb / 1024)} GB · ${displayNumber(stats.totalMb)} MB`;
  lengthStat.textContent = `${displayNumber(stats.totalSeconds / 3600)} 시간 · ${displayNumber(stats.totalSeconds)} 초`;
}

function updateStatsOnly(): void {
  const dayRecords = getDayRecords();
  const dayStats = calculateStatistics(dayRecords);
  updateFilterTabs(dayStats);
  const visible = getVisibleRecords(dayRecords);
  const filteredStats = selectedResultFilter === "all" ? dayStats : calculateStatistics(visible);
  refreshStatistics(filteredStats);
}

function updateOrderNumbers(): void {
  const dayRecords = getDayRecords();
  const dayCount = dayRecords.length;
  const orderMap = new Map<string, number>();
  for (let i = 0; i < dayCount; i++) {
    orderMap.set(dayRecords[i].id, dayCount - i);
  }
  list.querySelectorAll<HTMLElement>(".record-row").forEach((row) => {
    const id = row.dataset.id;
    if (!id) return;
    const order = orderMap.get(id);
    const orderEl = row.querySelector<HTMLElement>(".record-order");
    if (orderEl && order !== undefined) {
      orderEl.textContent = String(order);
      orderEl.setAttribute("aria-label", `기록 번호 ${order}`);
    }
  });
}

function updateRowResultUI(row: HTMLElement, result: RecordResult): void {
  const successBtn = row.querySelector<HTMLButtonElement>("[data-result='success']");
  const failBtn = row.querySelector<HTMLButtonElement>("[data-result='fail']");
  const isSuccess = result === "success";
  const isFail = result === "fail";
  if (successBtn) {
    successBtn.classList.toggle("selected", isSuccess);
    successBtn.setAttribute("aria-pressed", isSuccess ? "true" : "false");
    successBtn.textContent = isSuccess ? "✓ 성공" : "성공";
  }
  if (failBtn) {
    failBtn.classList.toggle("selected", isFail);
    failBtn.setAttribute("aria-pressed", isFail ? "true" : "false");
    failBtn.textContent = isFail ? "✓ 실패" : "실패";
  }
}

function render(): void {
  filter.value = selectedDate;
  const dayRecords = getDayRecords();
  const dayCount = dayRecords.length;

  const orderMap = new Map<string, number>();
  for (let i = 0; i < dayCount; i++) {
    orderMap.set(dayRecords[i].id, dayCount - i);
  }

  const dayStats = calculateStatistics(dayRecords);
  updateFilterTabs(dayStats);

  const visible = getVisibleRecords(dayRecords);
  const filteredStats = selectedResultFilter === "all" ? dayStats : calculateStatistics(visible);
  refreshStatistics(filteredStats);

  list.innerHTML = visible.length === 0
    ? `<p class="empty-state">${emptyMessage(dayCount)}</p>`
    : visible.map((record) => recordTemplate(record, orderMap.get(record.id) ?? 1)).join("");
}

function createId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0]}`;
}

function addRecord(): void {
  const newRecord: RecordItem = {
    id: createId(),
    timestamp: Date.now(),
    result: null,
    dataMb: null,
    lengthSeconds: null,
  };
  records = [newRecord, ...records];
  persist();
  setStatus("기록을 추가했습니다.");

  if (selectedResultFilter !== "all" || kstDate(newRecord.timestamp) !== selectedDate) {
    selectedResultFilter = "all";
    render();
    return;
  }

  const dayRecords = getDayRecords();
  const dayCount = dayRecords.length;

  const emptyEl = list.querySelector(".empty-state");
  if (emptyEl) {
    list.innerHTML = "";
  }

  list.insertAdjacentHTML("afterbegin", recordTemplate(newRecord, dayCount));
  updateStatsOnly();
}

function clearTimeErrors(): void {
  fieldHour.classList.remove("has-error");
  fieldMinute.classList.remove("has-error");
  fieldSecond.classList.remove("has-error");
  editTimeFeedback.textContent = "";
  editTimeFeedback.classList.remove("error");
}

function setTimeError(message: string, invalidField?: HTMLElement, inputToFocus?: HTMLInputElement): void {
  clearTimeErrors();
  if (invalidField) invalidField.classList.add("has-error");
  editTimeFeedback.textContent = message;
  editTimeFeedback.classList.add("error");
  if (inputToFocus) {
    inputToFocus.focus();
    inputToFocus.select();
  }
}

function openTimeEditDialog(timeEl: HTMLElement): void {
  const row = timeEl.closest<HTMLElement>(".record-row");
  if (!row || !row.dataset.id) return;
  const id = row.dataset.id;
  const targetRecord = records.find((r) => r.id === id);
  if (!targetRecord) return;

  editingRecordId = id;
  const orderEl = row.querySelector<HTMLElement>(".record-order");
  const order = orderEl?.textContent?.trim() ?? "";
  editTimeTitle.textContent = order ? `${order}번 기록 시간 수정` : "기록 시간 수정";

  const parts = kstTimeParts(targetRecord.timestamp);
  timeHourInput.value = parts.hour;
  timeMinuteInput.value = parts.minute;
  timeSecondInput.value = parts.second;

  clearTimeErrors();
  editTimeDialog.showModal();

  setTimeout(() => {
    timeHourInput.focus();
    timeHourInput.select();
  }, 50);
}

function handleTimeSegmentInput(
  currentInput: HTMLInputElement,
  nextInput: HTMLInputElement | null
): void {
  const sanitized = currentInput.value.replace(/\D/g, "").slice(0, 2);
  currentInput.value = sanitized;
  clearTimeErrors();

  if (sanitized.length === 2 && nextInput) {
    nextInput.focus();
    nextInput.select();
  }
}

function handleTimeSegmentKeydown(
  event: KeyboardEvent,
  currentInput: HTMLInputElement,
  prevInput: HTMLInputElement | null,
  nextInput: HTMLInputElement | null
): void {
  if (event.key === "ArrowRight") {
    if (currentInput.selectionStart === currentInput.value.length && nextInput) {
      event.preventDefault();
      nextInput.focus();
      nextInput.select();
    }
  } else if (event.key === "ArrowLeft") {
    if (currentInput.selectionStart === 0 && prevInput) {
      event.preventDefault();
      prevInput.focus();
      prevInput.select();
    }
  } else if (event.key === "Backspace") {
    if (currentInput.value === "" && prevInput) {
      event.preventDefault();
      prevInput.focus();
      prevInput.select();
    }
  }
}

function saveTimeEdit(): boolean {
  if (!editingRecordId) return false;
  const target = records.find((r) => r.id === editingRecordId);
  if (!target) {
    editTimeDialog.close();
    return false;
  }

  const hStr = timeHourInput.value.trim();
  const mStr = timeMinuteInput.value.trim();
  const sStr = timeSecondInput.value.trim();

  if (hStr === "" || isNaN(Number(hStr))) {
    setTimeError("시를 입력해 주세요.", fieldHour, timeHourInput);
    return false;
  }
  const h = Number(hStr);
  if (!Number.isInteger(h) || h < 0 || h > 23) {
    setTimeError("시는 00부터 23까지 입력할 수 있습니다.", fieldHour, timeHourInput);
    return false;
  }

  if (mStr === "" || isNaN(Number(mStr))) {
    setTimeError("분을 입력해 주세요.", fieldMinute, timeMinuteInput);
    return false;
  }
  const m = Number(mStr);
  if (!Number.isInteger(m) || m < 0 || m > 59) {
    setTimeError("분은 00부터 59까지 입력할 수 있습니다.", fieldMinute, timeMinuteInput);
    return false;
  }

  if (sStr === "" || isNaN(Number(sStr))) {
    setTimeError("초를 입력해 주세요.", fieldSecond, timeSecondInput);
    return false;
  }
  const s = Number(sStr);
  if (!Number.isInteger(s) || s < 0 || s > 59) {
    setTimeError("초는 00부터 59까지 입력할 수 있습니다.", fieldSecond, timeSecondInput);
    return false;
  }

  const recordDate = kstDate(target.timestamp);
  const newTimestamp = createKstTimestamp(recordDate, h, m, s);

  target.timestamp = newTimestamp;
  persist(true);
  editTimeDialog.close();
  editingRecordId = null;
  setStatus("기록 시간을 수정했습니다.");
  render();
  return true;
}

timeHourInput.addEventListener("input", () => handleTimeSegmentInput(timeHourInput, timeMinuteInput));
timeMinuteInput.addEventListener("input", () => handleTimeSegmentInput(timeMinuteInput, timeSecondInput));
timeSecondInput.addEventListener("input", () => handleTimeSegmentInput(timeSecondInput, null));

timeHourInput.addEventListener("keydown", (e) => handleTimeSegmentKeydown(e, timeHourInput, null, timeMinuteInput));
timeMinuteInput.addEventListener("keydown", (e) => handleTimeSegmentKeydown(e, timeMinuteInput, timeHourInput, timeSecondInput));
timeSecondInput.addEventListener("keydown", (e) => handleTimeSegmentKeydown(e, timeSecondInput, timeMinuteInput, null));

[timeHourInput, timeMinuteInput, timeSecondInput].forEach((input) => {
  input.addEventListener("focus", () => input.select());
});

editTimeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveTimeEdit();
});

editTimeDialog.addEventListener("click", (event) => {
  if (event.target === editTimeDialog) {
    editTimeDialog.close();
  }
});

root.addEventListener("click", (event) => {
  const timeEl = (event.target as Element).closest<HTMLElement>(".record-row time");
  if (timeEl !== null) {
    openTimeEditDialog(timeEl);
    return;
  }
  const button = (event.target as Element).closest<HTMLButtonElement>("button");
  if (button === null) return;
  const action = button.dataset.action;
  if (button.id === "add-record") { addRecord(); return; }
  if (action === "today") { selectedDate = todayKst(); setStatus(); render(); return; }
  if (action === "filter-result") {
    const nextFilter = button.dataset.filter as ResultFilter | undefined;
    if (nextFilter && nextFilter !== selectedResultFilter) {
      selectedResultFilter = nextFilter;
      render();
    }
    return;
  }
  if (action === "result") {
    const row = button.closest<HTMLElement>(".record-row");
    const result = button.dataset.result as Exclude<RecordResult, null> | undefined;
    if (row !== null && (result === "success" || result === "fail")) {
      const id = row.dataset.id ?? "";
      const current = records.find((record) => record.id === id);
      if (!current) return;
      const nextResult = current.result === result ? null : result;
      current.result = nextResult;
      persist(true);

      if (selectedResultFilter === "all") {
        updateRowResultUI(row, nextResult);
        updateStatsOnly();
      } else {
        const isStillVisible =
          (selectedResultFilter === "success" && nextResult === "success") ||
          (selectedResultFilter === "fail" && nextResult === "fail") ||
          (selectedResultFilter === "unspecified" && nextResult === null);

        if (isStillVisible) {
          updateRowResultUI(row, nextResult);
          updateStatsOnly();
        } else {
          row.remove();
          const dayRecords = getDayRecords();
          const visible = getVisibleRecords(dayRecords);
          if (visible.length === 0) {
            list.innerHTML = `<p class="empty-state">${emptyMessage(dayRecords.length)}</p>`;
          }
          updateStatsOnly();
        }
      }
    }
    return;
  }
  if (action === "delete") {
    const row = button.closest<HTMLElement>(".record-row");
    if (row !== null && window.confirm("이 기록을 삭제할까요?")) {
      const id = row.dataset.id ?? "";
      records = records.filter((record) => record.id !== id);
      persist(true);
      setStatus("기록을 삭제했습니다.");

      row.remove();
      const dayRecords = getDayRecords();
      const visible = getVisibleRecords(dayRecords);
      if (visible.length === 0) {
        list.innerHTML = `<p class="empty-state">${emptyMessage(dayRecords.length)}</p>`;
      } else {
        updateOrderNumbers();
      }
      updateStatsOnly();
    }
    return;
  }
  if (action === "clear-all") {
    if (window.confirm("모든 날짜의 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) {
      records = []; persist(); setStatus("전체 기록을 삭제했습니다."); render();
    }
    return;
  }
  if (action === "open-export") { void openExportDialog(); return; }
  if (action === "open-import") {
    importText.value = "";
    importFeedback.textContent = "";
    importFeedback.classList.remove("error");
    importDialog.showModal();
    return;
  }
  if (action === "close-dialog") { button.closest<HTMLDialogElement>("dialog")?.close(); return; }
  if (action === "copy-export") { void copyExportText(); return; }
  if (action === "import") { void handleImport(); }
});

function syncNumberInput(input: HTMLInputElement, isChange = false): void {
  if (input.dataset.field === undefined) return;
  const row = input.closest<HTMLElement>(".record-row");
  if (row === null || row.dataset.id === undefined) return;
  const target = records.find((record) => record.id === row.dataset.id);
  if (!target) return;

  const raw = input.value.trim();
  const value = raw === "" ? null : Number(raw);
  const field = input.dataset.field as "dataMb" | "lengthSeconds";

  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    setStatus("0 이상의 숫자만 입력할 수 있습니다.", true);
    input.value = numberValue(target[field]);
    return;
  }

  setStatus();
  target[field] = value;
  persist(isChange);
  updateStatsOnly();
}

list.addEventListener("input", (event) => {
  if (event.target instanceof HTMLInputElement) syncNumberInput(event.target, false);
});

list.addEventListener("change", (event) => {
  if (event.target instanceof HTMLInputElement) syncNumberInput(event.target, true);
});

filter.addEventListener("change", () => {
  if (filter.value !== "") { selectedDate = filter.value; setStatus(); render(); }
});

function resetCopyButton(): void {
  const copyBtn = exportDialog.querySelector<HTMLButtonElement>("[data-action='copy-export']");
  if (copyBtn !== null) {
    copyBtn.textContent = "문자열 복사";
    copyBtn.classList.remove("success-action");
  }
  if (copyTimeoutId !== null) {
    window.clearTimeout(copyTimeoutId);
    copyTimeoutId = null;
  }
}

async function openExportDialog(): Promise<void> {
  try {
    const dayRecords = getDayRecords();
    const visible = getVisibleRecords(dayRecords);
    exportText.value = await exportRecords(visible);
    exportFeedback.textContent = "";
    exportFeedback.classList.remove("error");
    resetCopyButton();
    exportDialog.showModal();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "내보내기에 실패했습니다.", true);
  }
}

async function copyExportText(): Promise<void> {
  const copyBtn = exportDialog.querySelector<HTMLButtonElement>("[data-action='copy-export']");
  try {
    await navigator.clipboard.writeText(exportText.value);
    setStatus("내보내기 문자열을 클립보드에 복사했습니다.");
    exportFeedback.textContent = "✓ 클립보드에 복사되었습니다!";
    exportFeedback.classList.remove("error");
    if (copyBtn !== null) {
      copyBtn.textContent = "✓ 복사 완료!";
      copyBtn.classList.add("success-action");
    }
    if (copyTimeoutId !== null) {
      window.clearTimeout(copyTimeoutId);
    }
    copyTimeoutId = window.setTimeout(() => {
      resetCopyButton();
      exportFeedback.textContent = "";
    }, 2500);
  } catch {
    exportText.select();
    setStatus("문자열을 선택했습니다. 직접 복사해 주세요.");
    exportFeedback.textContent = "문자열이 선택되었습니다. 직접 복사해 주세요.";
    exportFeedback.classList.add("error");
  }
}

async function handleImport(): Promise<void> {
  try {
    const incoming = await importRecords(importText.value);
    const ids = new Set(records.map((record) => record.id));
    const matching = incoming.filter((record) => kstDate(record.timestamp) === selectedDate && !ids.has(record.id));
    records = [...records, ...matching];
    persist(); render(); importDialog.close();
    setStatus(`${matching.length}개의 기록을 병합했습니다. 중복 또는 다른 날짜 기록은 제외했습니다.`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "가져오기에 실패했습니다.";
    setStatus(msg, true);
    importFeedback.textContent = msg;
    importFeedback.classList.add("error");
  }
}

render();

