import { parseAppData, resolveSessionNames, serializeAppData, type AppData, type RecordItem } from "../models/record";
import { backupFilename, parseBackup, planMerge, serializeBackup, suggestSessionChoices, summarizeData,
  type BackupFile, type ConflictSide, type MergeChoices, type MergePlan, type MergeSession, type RecordReview, type RestoreMode } from "../services/backup";
import { kstDate, kstTime } from "../services/date";

interface BackupActions {
  getData(): AppData;
  apply(data: AppData, mode: RestoreMode): boolean;
  status(message: string, error?: boolean): void;
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text: string, action: () => void, className = "secondary outline"): HTMLButtonElement {
  const node = element("button", text, className);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
const timestampLabel = (timestamp: number): string => kstDate(timestamp) + " " + kstTime(timestamp);
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : "파일을 읽지 못했습니다. 다시 선택해 주세요.";
const fields = (record: RecordItem): string[] => [
  timestampLabel(record.timestamp), record.result === null ? "미지정" : record.result === "success" ? "성공" : "실패",
  record.dataMb === null ? "미입력" : record.dataMb + " MB",
  record.lengthSeconds === null ? "미입력" : record.lengthSeconds + " 초", record.memo || "없음",
];

export function createBackupDialog(actions: BackupActions): { open(): void; download(): void } {
  const dialog = element("dialog");
  dialog.id = "restore-dialog";
  dialog.setAttribute("aria-labelledby", "restore-title");
  dialog.innerHTML = '<article><header><h3 id="restore-title">백업 파일 복원</h3><button type="button" class="close-button" aria-label="닫기">✕</button></header>' +
    '<label for="backup-file">전체 백업 JSON 파일</label><input id="backup-file" type="file" accept=".json,application/json" />' +
    '<p class="restore-feedback" role="status" aria-live="polite"></p>' +
    '<fieldset class="restore-modes" hidden><legend>복원 방식 선택</legend>' +
    '<label><input type="radio" name="restore-mode" value="replace" /> 전체 교체</label>' +
    '<label><input type="radio" name="restore-mode" value="merge" /> 병합</label></fieldset>' +
    '<div class="restore-preview"></div><footer><button type="button" class="secondary outline" data-restore="cancel">취소</button>' +
    '<button type="button" class="secondary outline" data-restore="download">현재 데이터 백업</button>' +
    '<button type="button" data-restore="apply" disabled>복원 방식 선택</button></footer></article>';
  document.body.append(dialog);
  const article = dialog.querySelector<HTMLElement>("article")!;
  const fileInput = dialog.querySelector<HTMLInputElement>("#backup-file")!;
  const feedback = dialog.querySelector<HTMLElement>(".restore-feedback")!;
  const modes = dialog.querySelector<HTMLFieldSetElement>(".restore-modes")!;
  const preview = dialog.querySelector<HTMLElement>(".restore-preview")!;
  const applyButton = dialog.querySelector<HTMLButtonElement>('[data-restore="apply"]')!;
  let backup: BackupFile | null = null, mode: RestoreMode | null = null, filename = "", generation = 0;
  let snapshot: AppData | null = null, baseline = "", choices: MergeChoices = {}, plan: MergePlan | null = null, applying = false;
  const openDetails = new Set<string>(), pages = new Map<string, number>();
  let returnFocus: HTMLElement | null = null;

  function message(text: string, error = false): void {
    feedback.textContent = text;
    feedback.classList.toggle("error", error);
  }
  function captureCurrent(): void {
    baseline = serializeAppData(actions.getData());
    snapshot = parseAppData(JSON.parse(baseline) as unknown)!;
    choices = backup ? suggestSessionChoices(snapshot, backup.data) : {};
  }
  function resetFile(): void {
    generation++;
    backup = null; mode = null; snapshot = null; plan = null; choices = {};
    openDetails.clear(); pages.clear(); preview.replaceChildren(); modes.hidden = true;
    modes.querySelectorAll<HTMLInputElement>("input").forEach((input) => { input.checked = false; });
    applyButton.disabled = true; applyButton.textContent = "복원 방식 선택";
    message("");
  }
  function download(): void {
    try {
      const now = Date.now();
      const url = URL.createObjectURL(new Blob([serializeBackup(actions.getData(), now)], { type: "application/json;charset=utf-8" }));
      const link = element("a");
      link.href = url; link.download = backupFilename(now);
      document.body.append(link);
      try { link.click(); } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      const text = "전체 백업 파일 다운로드를 시작했습니다.";
      actions.status(text);
      if (dialog.open) message(text);
    } catch (error) {
      const text = error instanceof Error ? error.message : "전체 백업 파일 생성에 실패했습니다.";
      actions.status(text, true);
      if (dialog.open) message(text, true);
    }
  }
  function lazyDetails(key: string, label: string, build: (body: HTMLElement) => void): HTMLDetailsElement {
    const details = element("details", undefined, "restore-details");
    const summary = element("summary", label);
    summary.dataset.focusKey = key;
    const body = element("div");
    details.append(summary, body);
    let built = false;
    const populate = () => { if (!built) { build(body); built = true; } };
    details.open = openDetails.has(key);
    if (details.open) populate();
    details.addEventListener("toggle", () => {
      if (!details.isConnected) return;
      if (details.open) { openDetails.add(key); populate(); } else openDetails.delete(key);
    });
    return details;
  }
  function paginate<T>(body: HTMLElement, key: string, items: T[], renderItem: (item: T, index: number) => HTMLElement): void {
    const page = Math.min(pages.get(key) ?? 0, Math.max(0, Math.ceil(items.length / 25) - 1));
    const start = page * 25, end = Math.min(items.length, start + 25);
    const contents = element("div");
    items.slice(start, end).forEach((item, index) => contents.append(renderItem(item, start + index)));
    body.append(contents);
    if (items.length > 25) {
      const nav = element("div", undefined, "restore-pages");
      const previous = button("이전 25개", () => { pages.set(key, page - 1); renderPreview(); });
      const next = button("다음 25개", () => { pages.set(key, page + 1); renderPreview(); });
      previous.disabled = page === 0; next.disabled = end === items.length;
      previous.dataset.focusKey = key + "/prev"; next.dataset.focusKey = key + "/next";
      nav.append(previous, element("span", (start + 1) + "–" + end + " / " + items.length), next);
      body.append(nav);
    }
  }
  function recordList(key: string, label: string, records: RecordItem[]): HTMLDetailsElement {
    return lazyDetails(key, label + " (" + records.length + "개)", (body) => {
      if (records.length === 0) { body.append(element("p", "기록이 없습니다.")); return; }
      paginate(body, key, records, (record, index) => lazyDetails(key + "/" + index,
        (index + 1) + "번 · " + timestampLabel(record.timestamp), (content) => {
          const values = fields(record);
          content.append(element("p", "ID: " + record.id, "restore-id"));
          ["시각", "결과", "용량", "길이", "메모"].forEach((title, field) => {
            content.append(element("strong", title), element("p", values[field], "restore-value"));
          });
        }));
    });
  }
  function summaryTable(result: AppData | null): HTMLElement {
    const wrapper = element("div", undefined, "restore-table-scroll");
    const table = element("table", undefined, "restore-counts");
    const head = element("thead"), headings = element("tr");
    ["데이터", "날짜", "세션", "기록"].forEach((text) => headings.append(element("th", text)));
    head.append(headings); table.append(head);
    const body = element("tbody");
    const rows: [string, AppData][] = [["현재", snapshot!], ["백업", backup!.data]];
    if (result) rows.push(["복원 결과", result]);
    rows.forEach(([label, data]) => {
      const stats = summarizeData(data), row = element("tr"), heading = element("th", label);
      heading.scope = "row";
      row.append(heading);
      [stats.dates, stats.sessions, stats.records].forEach((value) => row.append(element("td", value.toLocaleString())));
      body.append(row);
    });
    table.append(body); wrapper.append(table);
    return wrapper;
  }
  function recordReview(row: MergeSession, review: RecordReview): HTMLElement {
    const key = row.key + "/record/" + review.index;
    const state = review.collision ? "시각 겹침" : review.target === undefined ? "연결 필요" : review.conflict ? review.side === undefined ? "값 선택 필요" : review.side === "current" ? "현재 유지" : "백업 적용" : "동일 기록";
    return lazyDetails(key, "백업 " + (review.index + 1) + "번 · " + timestampLabel(review.incoming.timestamp) + " · " + state, (body) => {
      if (review.ambiguous) {
        const label = element("label", "같은 ID 또는 시각의 후보 중 연결할 기록");
        const select = element("select");
        select.dataset.focusKey = key + "/target";
        select.append(new Option("연결 대상을 선택하세요", ""));
        review.candidates.forEach((candidate) => select.append(new Option(
          (candidate.index + 1) + "번 · " + timestampLabel(candidate.record.timestamp) + " · ID " + candidate.record.id, String(candidate.index))));
        select.value = review.target === undefined ? "" : String(review.target);
        select.addEventListener("change", () => {
          choices[row.key].records[review.index] = { target: select.value === "" ? undefined : Number(select.value), matchToken: review.matchToken };
          renderPreview();
        });
        label.append(select); body.append(label);
        body.append(lazyDetails(key + "/candidates", "후보 기록 내용 확인", (content) => {
          for (const candidate of review.candidates) {
            content.append(element("h4", (candidate.index + 1) + "번 · ID " + candidate.record.id));
            fields(candidate.record).forEach((value, index) => content.append(element("p",
              ["시각: ", "결과: ", "용량: ", "길이: ", "메모: "][index] + value, "restore-value")));
          }
        }));
      }
      if (review.current) {
        const comparison = element("div", undefined, "restore-comparison");
        const left = fields(review.current), right = fields(review.incoming);
        ["현재 기록", "백업 기록"].forEach((title, side) => {
          const column = element("section");
          column.append(element("h4", title), element("p", "ID: " + (side === 0 ? review.current!.id : review.incoming.id), "restore-id"));
          ["시각", "결과", "용량", "길이", "메모"].forEach((name, index) => {
            const field = element("div", undefined, left[index] === right[index] ? "restore-field" : "restore-field restore-difference");
            field.append(element("strong", name + (left[index] === right[index] ? "" : " · 다름")),
              element("p", (side === 0 ? left : right)[index], "restore-value"));
            column.append(field);
          });
          comparison.append(column);
        });
        body.append(comparison);
        if (review.conflict) {
          const label = element("label", "적용할 기록");
          const select = element("select");
          select.dataset.focusKey = key + "/side";
          select.append(new Option("현재 값 또는 백업 값을 선택하세요", ""), new Option("현재 기록 유지", "current"), new Option("백업 기록 적용", "backup"));
          select.value = review.side ?? "";
          select.addEventListener("change", () => {
            choices[row.key].records[review.index] = { ...choices[row.key].records[review.index],
              side: select.value === "" ? undefined : select.value as ConflictSide, valueToken: review.valueToken };
            renderPreview();
          });
          label.append(select); body.append(label);
        }
      } else {
        body.append(element("h4", "백업 기록"));
        fields(review.incoming).forEach((value, index) => body.append(element("p", ["시각: ", "결과: ", "용량: ", "길이: ", "메모: "][index] + value, "restore-value")));
      }
      if (review.collision) body.append(element("p", review.collision, "restore-error"));
    });
  }
  function sessionRow(row: MergeSession): HTMLElement {
    const section = element("section", undefined, "restore-session");
    section.append(element("h4", row.date + " · " + row.sourceName + " (" + (row.index + 1) + "번째, 기록 " + row.source.records.length + "개)"));
    const existing = snapshot!.sessionsByDate[row.date] ?? [], names = resolveSessionNames(existing);
    const label = element("label", "연결할 현재 세션");
    const select = element("select");
    select.dataset.focusKey = row.key + "/target";
    select.append(new Option("연결 대상을 선택하세요", ""), new Option("새 세션으로 추가", "new"));
    existing.forEach((session, index) => select.append(new Option(names[index] + " (" + (index + 1) + "번째, 기록 " + session.records.length + "개)", String(index))));
    select.value = row.target === null ? "" : String(row.target);
    select.addEventListener("change", () => {
      choices[row.key] = { target: select.value === "" ? null : select.value === "new" ? "new" : Number(select.value), records: {} };
      for (const key of openDetails) if (key.startsWith(row.key + "/record/")) openDetails.delete(key);
      renderPreview();
    });
    label.append(select); section.append(label);
    if (row.target === "new") {
      const nameLabel = element("label", "새 세션 이름 (비워 두면 자동 지정)");
      const input = element("input");
      input.type = "text"; input.value = choices[row.key].name ?? row.source.name ?? "";
      input.dataset.focusKey = row.key + "/name";
      input.addEventListener("input", () => { choices[row.key].name = input.value; renderPreview(); });
      nameLabel.append(input); section.append(nameLabel);
    }
    if (row.resultName !== undefined) section.append(element("p", "결과: " + row.resultName + " · " + (row.resultIndex! + 1) + "번째 세션"));
    row.issues.forEach((issue) => section.append(element("p", issue, "restore-error")));
    section.append(recordList(row.key + "/source", "백업 기록 보기", row.source.records));
    if (typeof row.target === "number" && existing[row.target]) section.append(recordList(row.key + "/current", "현재 기록 보기", existing[row.target].records));
    if (row.reviews.length > 0) {
      const unresolved = row.reviews.filter((review) => review.target === undefined || (review.conflict && !review.side) || review.collision).length;
      section.append(lazyDetails(row.key + "/reviews", "기록 비교 " + row.reviews.length + "개 · 미해결 " + unresolved + "개", (body) => {
        paginate(body, row.key + "/reviews", row.reviews, (review) => recordReview(row, review));
      }));
    } else if (typeof row.target === "number" && row.issues.length === 0) {
      section.append(element("p", "기록 내용 충돌이 없습니다. 개별 확인 없이 병합할 수 있습니다.", "restore-muted"));
    }
    return section;
  }
  function chooseRemaining(side: ConflictSide): void {
    if (!plan) return;
    for (const row of plan.sessions) for (const review of row.reviews) {
      if (review.conflict && review.target !== undefined && review.side === undefined) {
        choices[row.key].records[review.index] = { ...choices[row.key].records[review.index], side, valueToken: review.valueToken };
      }
    }
    renderPreview();
    if (!applyButton.disabled) applyButton.focus();
  }
  function renderPreview(): void {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusKey = active?.dataset.focusKey, scrollTop = article.scrollTop;
    const selection = active instanceof HTMLInputElement && active.type === "text" ? [active.selectionStart, active.selectionEnd] : null;
    preview.replaceChildren();
    if (!backup || !snapshot) return;
    plan = mode === "merge" ? planMerge(snapshot, backup.data, choices) : null;
    const stats = summarizeData(backup.data);
    preview.append(element("p", filename + " · 생성 " + timestampLabel(Date.parse(backup.createdAt)) + " (한국 시간)", "restore-file-meta"));
    preview.append(element("p", "백업 날짜 범위: " + (stats.firstDate ? stats.firstDate + " ~ " + stats.lastDate : "날짜 없음")));
    preview.append(summaryTable(mode === "replace" ? backup.data : plan?.data ?? null));
    backup.warnings.forEach((warning) => preview.append(element("p", warning, "restore-warning")));
    if (mode === "replace") {
      preview.append(element("p", "현재 모든 세션과 기록을 백업 내용으로 교체합니다.", "restore-warning"));
      preview.append(lazyDetails("replace-sessions", "복원할 세션과 기록 확인", (body) => {
        for (const [date, sessions] of Object.entries(backup!.data.sessionsByDate)) {
          const names = resolveSessionNames(sessions);
          sessions.forEach((session, index) => body.append(recordList(date + "/replace/" + index, date + " · " + names[index] + " (" + (index + 1) + "번째)", session.records)));
        }
      }));
    }
    if (plan) {
      const counts = plan.counts;
      preview.append(element("p", "현재 선택 기준: 새 날짜 " + counts.addedDates + "개 · 새 세션 " + counts.addedSessions + "개 · 새 기록 " + counts.addedRecords + "개"));
      preview.append(element("p", "동일 기록 건너뜀 " + counts.identical + "개 · 충돌 중 현재 유지 " + counts.kept + "개 · 백업 값으로 갱신 " + counts.updated + "개"));
      const remaining = element("p", "미해결 항목 " + plan.pending + "개", plan.pending > 0 ? "restore-warning" : "restore-ready");
      remaining.setAttribute("role", "status"); preview.append(remaining);
      preview.append(element("p", "세션 연결과 아래 결과를 확인한 뒤 병합하기를 누르세요. 현재에만 있는 데이터는 유지됩니다.", "restore-muted"));
      if (plan.sessions.some((row) => row.reviews.some((review) => review.conflict && review.side === undefined))) {
        const batch = element("div", undefined, "restore-batch");
        batch.append(button("미선택 항목 모두 현재 기록 유지", () => chooseRemaining("current")),
          button("미선택 항목 모두 백업 기록 적용", () => chooseRemaining("backup")));
        preview.append(batch);
      }
      plan.sessions.forEach((row) => preview.append(sessionRow(row)));
    }
    applyButton.textContent = mode === "replace" ? "백업으로 교체" : mode === "merge" ? "병합하기" : "복원 방식 선택";
    applyButton.disabled = applying || mode === null || (plan !== null && plan.pending > 0);
    if (focusKey) {
      const replacement = [...preview.querySelectorAll<HTMLElement>("[data-focus-key]")].find((node) => node.dataset.focusKey === focusKey);
      replacement?.focus({ preventScroll: true });
      if (selection && replacement instanceof HTMLInputElement) replacement.setSelectionRange(selection[0], selection[1]);
    }
    article.scrollTop = scrollTop;
  }

  fileInput.addEventListener("click", () => { resetFile(); fileInput.value = ""; });
  fileInput.addEventListener("cancel", resetFile);
  fileInput.addEventListener("change", () => {
    resetFile();
    const file = fileInput.files?.[0];
    if (!file) return;
    const request = generation;
    filename = file.name; message("백업 파일을 읽고 있습니다.");
    void file.text().then((text) => {
      if (request !== generation || !dialog.open) return;
      backup = parseBackup(text); captureCurrent(); modes.hidden = false;
      message("파일을 확인했습니다. 복원 방식을 선택해 주세요."); renderPreview();
    }).catch((error: unknown) => {
      if (request === generation && dialog.open) { resetFile(); message(errorMessage(error), true); }
    });
  });
  modes.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    mode = input.value as RestoreMode;
    choices = suggestSessionChoices(snapshot!, backup!.data);
    openDetails.clear(); pages.clear(); message(""); renderPreview();
  });
  dialog.querySelector(".close-button")!.addEventListener("click", () => dialog.close());
  dialog.querySelector('[data-restore="cancel"]')!.addEventListener("click", () => dialog.close());
  dialog.querySelector('[data-restore="download"]')!.addEventListener("click", download);
  dialog.addEventListener("close", () => { if (!dialog.open) { resetFile(); returnFocus?.focus({ preventScroll: true }); } });
  applyButton.addEventListener("click", () => {
    if (applying || !backup || !mode || !snapshot || (plan && plan.pending > 0)) return;
    if (serializeAppData(actions.getData()) !== baseline) {
      captureCurrent(); openDetails.clear(); pages.clear(); renderPreview();
      message("미리보기 이후 현재 데이터가 바뀌었습니다. 연결과 충돌 선택을 다시 계산했으니 결과를 확인한 뒤 실행해 주세요.", true);
      return;
    }
    const candidate = mode === "replace" ? backup.data : plan!.data;
    if ((mode === "merge" && !plan!.changed) || (mode === "replace" && serializeAppData(candidate) === baseline)) {
      dialog.close(); actions.status("변경할 데이터가 없습니다."); return;
    }
    applying = true; applyButton.disabled = true;
    try {
      if (!actions.apply(candidate, mode)) {
        message("저장 공간이 부족하거나 저장소를 사용할 수 없어 복원하지 못했습니다. 현재 데이터를 백업한 뒤 다시 시도해 주세요.", true);
        return;
      }
      dialog.close();
      actions.status(mode === "replace" ? "전체 데이터를 백업으로 교체했습니다." : "백업 데이터를 병합했습니다.");
    } finally { applying = false; if (dialog.open) renderPreview(); }
  });
  return {
    download,
    open() {
      returnFocus = document.querySelector<HTMLElement>(".header-menu > summary");
      resetFile(); fileInput.value = "";
      dialog.showModal();
      fileInput.focus();
    },
  };
}
