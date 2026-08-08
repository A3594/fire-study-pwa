(() => {
  "use strict";

  const DATA = window.FIRE_STUDY_DATA || { metadata: {}, cards: [] };
  const CARDS = Array.isArray(DATA.cards) ? DATA.cards : [];
  const PROGRESS_KEY = "fire-study-progress-v1";
  const SETTINGS_KEY = "fire-study-settings-v1";
  const DAY = 24 * 60 * 60 * 1000;
  const MINUTE = 60 * 1000;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const dom = {
    screens: $$('[data-screen]'),
    sourceTabs: $$('[data-source]'),
    subject: $('[data-subject-select]'),
    search: $('[data-search]'),
    mnemonicOnly: $('[data-mnemonic-only]'),
    totalBadge: $('[data-total-badge]'),
    dueCount: $('[data-due-count]'),
    newCount: $('[data-new-count]'),
    learnedCount: $('[data-learned-count]'),
    dueButtonCopy: $('[data-due-button-copy]'),
    startDue: $('[data-start-due]'),
    startRandom: $('[data-start-random]'),
    progress: $('[data-progress]'),
    progressBar: $('[data-progress-bar]'),
    studyKind: $('[data-study-kind]'),
    cardNumber: $('[data-card-number]'),
    cardSubject: $('[data-card-subject]'),
    question: $('[data-question]'),
    mnemonic: $('[data-mnemonic]'),
    mnemonicSide: $('[data-mnemonic-side]'),
    reveal: $('[data-reveal]'),
    ratingGrid: $('[data-rating-grid]'),
    thinkGuide: $('[data-think-guide]'),
    finishCopy: $('[data-finish-copy]'),
    resultAgain: $('[data-result-again]'),
    resultHard: $('[data-result-hard]'),
    resultGood: $('[data-result-good]'),
    settingsModal: $('[data-settings-modal]'),
    sessionLimit: $('[data-session-limit]'),
    installButton: $('[data-install]'),
    offlineState: $('[data-offline-state]'),
    dataVersion: $('[data-data-version]'),
    toast: $('[data-toast]')
  };

  const state = {
    source: "화재안전기술기준",
    subject: "전체",
    search: "",
    mnemonicOnly: true,
    progress: loadJson(PROGRESS_KEY, {}),
    settings: { sessionLimit: 20, ...loadJson(SETTINGS_KEY, {}) },
    session: [],
    sessionOriginal: [],
    cursor: 0,
    completed: 0,
    repeated: new Set(),
    results: { again: 0, hard: 0, good: 0 },
    lastMode: "due",
    installPrompt: null
  };

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveProgress() {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(state.progress));
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function showScreen(name) {
    dom.screens.forEach((screen) => {
      const active = screen.dataset.screen === name;
      screen.classList.toggle("is-active", active);
      screen.hidden = !active;
    });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function normalize(value) {
    return String(value || "").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim();
  }

  function filteredCards() {
    const search = normalize(state.search);
    return CARDS.filter((card) => {
      if (state.source !== "전체" && card.kind !== state.source) return false;
      if (state.subject !== "전체" && card.subject !== state.subject) return false;
      if (state.mnemonicOnly && !card.hasMnemonic) return false;
      if (!search) return true;
      return normalize(`${card.question} ${card.mnemonic} ${card.subject}`).includes(search);
    });
  }

  function getRecord(card) {
    return state.progress[card.id] || { reps: 0, lapses: 0, intervalDays: 0, dueAt: 0 };
  }

  function isDue(card, now = Date.now()) {
    const record = getRecord(card);
    return record.reps > 0 && Number(record.dueAt || 0) <= now;
  }

  function updateSubjects() {
    const cardsForSource = CARDS.filter((card) => state.source === "전체" || card.kind === state.source);
    const counts = cardsForSource.reduce((map, card) => {
      map.set(card.subject, (map.get(card.subject) || 0) + 1);
      return map;
    }, new Map());
    const subjects = [...counts.keys()].sort((a, b) => a.localeCompare(b, "ko"));
    const previous = subjects.includes(state.subject) ? state.subject : "전체";
    dom.subject.innerHTML = "";
    dom.subject.append(new Option(`전체 과목 (${cardsForSource.length})`, "전체"));
    subjects.forEach((subject) => dom.subject.append(new Option(`${subject} (${counts.get(subject)})`, subject)));
    dom.subject.value = previous;
    state.subject = previous;
  }

  function updateDashboard() {
    const cards = filteredCards();
    const now = Date.now();
    const due = cards.filter((card) => isDue(card, now)).length;
    const fresh = cards.filter((card) => getRecord(card).reps === 0).length;
    const learned = cards.length - fresh;
    dom.totalBadge.textContent = `${cards.length.toLocaleString("ko-KR")}문제`;
    dom.dueCount.textContent = due.toLocaleString("ko-KR");
    dom.newCount.textContent = fresh.toLocaleString("ko-KR");
    dom.learnedCount.textContent = learned.toLocaleString("ko-KR");
    const limit = Number(state.settings.sessionLimit) || 20;
    const todayCount = Math.min(limit, due + fresh);
    dom.dueButtonCopy.textContent = todayCount
      ? `복습 ${due}개 · 새 카드 ${Math.max(0, todayCount - Math.min(due, limit))}개`
      : "오늘 예정된 카드가 없습니다";
    dom.startDue.disabled = cards.length === 0;
    dom.startRandom.disabled = cards.length === 0;
  }

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function startSession(mode) {
    const cards = filteredCards();
    if (!cards.length) {
      showToast("선택한 범위에 학습할 카드가 없습니다.");
      return;
    }
    const limit = Number(state.settings.sessionLimit) || 20;
    let selected;
    if (mode === "random") {
      selected = shuffle(cards).slice(0, limit);
    } else {
      const due = shuffle(cards.filter((card) => isDue(card))).sort(
        (a, b) => Number(getRecord(a).dueAt) - Number(getRecord(b).dueAt)
      );
      const fresh = shuffle(cards.filter((card) => getRecord(card).reps === 0));
      selected = [...due, ...fresh].slice(0, limit);
      if (!selected.length) selected = shuffle(cards).slice(0, Math.min(limit, cards.length));
    }
    state.lastMode = mode;
    state.session = selected;
    state.sessionOriginal = [...selected];
    state.cursor = 0;
    state.completed = 0;
    state.repeated = new Set();
    state.results = { again: 0, hard: 0, good: 0 };
    showScreen("study");
    renderCard();
  }

  function currentCard() {
    return state.session[state.cursor];
  }

  function renderCard() {
    const card = currentCard();
    if (!card) {
      finishSession();
      return;
    }
    const total = Math.max(state.sessionOriginal.length, state.completed + 1);
    const shown = Math.min(state.completed + 1, total);
    dom.progress.textContent = `${shown} / ${total}`;
    dom.progressBar.style.width = `${Math.max(3, (state.completed / total) * 100)}%`;
    dom.studyKind.textContent = card.kind;
    dom.cardNumber.textContent = String(card.order || state.cursor + 1).padStart(3, "0");
    dom.cardSubject.textContent = card.subject;
    dom.question.textContent = card.question;
    dom.mnemonic.textContent = card.hasMnemonic ? card.mnemonic : "니모닉 미등록";
    dom.mnemonicSide.hidden = true;
    dom.ratingGrid.hidden = true;
    dom.reveal.hidden = false;
    dom.thinkGuide.hidden = false;
    dom.reveal.focus({ preventScroll: true });
  }

  function revealMnemonic() {
    if (!currentCard()) return;
    dom.mnemonicSide.hidden = false;
    dom.ratingGrid.hidden = false;
    dom.reveal.hidden = true;
    dom.thinkGuide.hidden = true;
    $('[data-rating="good"]').focus({ preventScroll: true });
  }

  function rateCard(rating) {
    const card = currentCard();
    if (!card || dom.ratingGrid.hidden) return;
    const now = Date.now();
    const previous = getRecord(card);
    const next = { ...previous, reps: Number(previous.reps || 0) + 1, lastRating: rating, reviewedAt: now };

    if (rating === "again") {
      next.lapses = Number(previous.lapses || 0) + 1;
      next.intervalDays = 0;
      next.dueAt = now + 10 * MINUTE;
      if (!state.repeated.has(card.id)) {
        state.repeated.add(card.id);
        state.session.push(card);
      }
    } else if (rating === "hard") {
      next.intervalDays = Math.max(1, Math.round(Number(previous.intervalDays || 0) * 1.25));
      next.dueAt = now + next.intervalDays * DAY;
    } else {
      next.intervalDays = previous.reps ? Math.max(3, Math.round(Number(previous.intervalDays || 1) * 2.2)) : 3;
      next.dueAt = now + next.intervalDays * DAY;
    }

    state.progress[card.id] = next;
    state.results[rating] += 1;
    state.completed += 1;
    state.cursor += 1;
    saveProgress();
    renderCard();
  }

  function finishSession() {
    dom.resultAgain.textContent = state.results.again;
    dom.resultHard.textContent = state.results.hard;
    dom.resultGood.textContent = state.results.good;
    const reviewed = state.results.again + state.results.hard + state.results.good;
    dom.finishCopy.textContent = `${reviewed}번 판단했습니다. ‘다시’로 고른 카드는 10분 뒤 복습 대상에 포함됩니다.`;
    showScreen("finish");
    updateDashboard();
  }

  function goHome() {
    showScreen("home");
    updateDashboard();
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      dom.toast.hidden = true;
    }, 2600);
  }

  function openSettings() {
    dom.sessionLimit.value = String(state.settings.sessionLimit);
    dom.settingsModal.hidden = false;
    document.body.classList.add("modal-open");
    dom.sessionLimit.focus();
  }

  function closeSettings() {
    dom.settingsModal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  function setOnlineState() {
    dom.offlineState.textContent = navigator.onLine ? "온라인 · 오프라인 학습 준비됨" : "오프라인 · 저장된 카드로 학습 중";
  }

  function setDataVersion() {
    const date = DATA.metadata?.generatedAt ? new Date(DATA.metadata.generatedAt) : null;
    dom.dataVersion.textContent = date && !Number.isNaN(date.valueOf())
      ? `Logseq ${date.toLocaleDateString("ko-KR")}`
      : `${CARDS.length}개 카드`;
  }

  function bindEvents() {
    dom.sourceTabs.forEach((button) => {
      button.addEventListener("click", () => {
        state.source = button.dataset.source;
        dom.sourceTabs.forEach((tab) => tab.classList.toggle("is-selected", tab === button));
        updateSubjects();
        updateDashboard();
      });
    });
    dom.subject.addEventListener("change", () => {
      state.subject = dom.subject.value;
      updateDashboard();
    });
    dom.search.addEventListener("input", () => {
      state.search = dom.search.value;
      updateDashboard();
    });
    dom.mnemonicOnly.addEventListener("change", () => {
      state.mnemonicOnly = dom.mnemonicOnly.checked;
      updateDashboard();
    });
    dom.startDue.addEventListener("click", () => startSession("due"));
    dom.startRandom.addEventListener("click", () => startSession("random"));
    dom.reveal.addEventListener("click", revealMnemonic);
    $$('[data-rating]').forEach((button) => button.addEventListener("click", () => rateCard(button.dataset.rating)));
    $$('[data-go-home]').forEach((button) => button.addEventListener("click", goHome));
    $('[data-exit-study]').addEventListener("click", goHome);
    $('[data-repeat-session]').addEventListener("click", () => startSession(state.lastMode));
    $$('[data-open-settings]').forEach((button) => button.addEventListener("click", openSettings));
    $$('[data-close-settings]').forEach((button) => button.addEventListener("click", closeSettings));
    dom.sessionLimit.addEventListener("change", () => {
      state.settings.sessionLimit = Number(dom.sessionLimit.value);
      saveSettings();
      updateDashboard();
      showToast(`한 번에 ${state.settings.sessionLimit}개로 저장했습니다.`);
    });
    $('[data-reset-progress]').addEventListener("click", () => {
      if (!window.confirm("이 기기에 저장된 학습 진도를 모두 초기화할까요? Logseq 원문은 변경되지 않습니다.")) return;
      state.progress = {};
      saveProgress();
      closeSettings();
      updateDashboard();
      showToast("학습 진도를 초기화했습니다.");
    });
    window.addEventListener("online", setOnlineState);
    window.addEventListener("offline", setOnlineState);
    window.addEventListener("keydown", (event) => {
      if (dom.settingsModal && !dom.settingsModal.hidden) {
        if (event.key === "Escape") closeSettings();
        return;
      }
      if ($('[data-screen="study"]').hidden) return;
      if (event.code === "Space") {
        event.preventDefault();
        revealMnemonic();
      } else if (!dom.ratingGrid.hidden && ["1", "2", "3"].includes(event.key)) {
        rateCard({ 1: "again", 2: "hard", 3: "good" }[event.key]);
      }
    });
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      state.installPrompt = event;
      dom.installButton.hidden = false;
    });
    dom.installButton.addEventListener("click", async () => {
      if (!state.installPrompt) return;
      state.installPrompt.prompt();
      await state.installPrompt.userChoice;
      state.installPrompt = null;
      dom.installButton.hidden = true;
    });
    window.addEventListener("appinstalled", () => showToast("홈 화면에 설치했습니다."));
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("./service-worker.js");
    } catch (error) {
      console.warn("서비스 워커 등록 실패", error);
      dom.offlineState.textContent = "오프라인 저장을 준비하지 못했습니다";
    }
  }

  function init() {
    bindEvents();
    updateSubjects();
    updateDashboard();
    setOnlineState();
    setDataVersion();
    dom.sessionLimit.value = String(state.settings.sessionLimit);
    registerServiceWorker();
  }

  init();
})();
