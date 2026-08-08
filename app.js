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
    startListening: $('[data-start-listening]'),
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
    listenProgress: $('[data-listen-progress]'),
    listenProgressBar: $('[data-listen-progress-bar]'),
    listenCycle: $('[data-listen-cycle]'),
    listenSubject: $('[data-listen-subject]'),
    listenQuestion: $('[data-listen-question]'),
    listenMnemonic: $('[data-listen-mnemonic]'),
    listenMnemonicBox: $('[data-listen-mnemonic-box]'),
    listenPhase: $('[data-listen-phase]'),
    listenPulse: $('[data-listen-pulse]'),
    listenCountdown: $('[data-listen-countdown]'),
    listenSeconds: $('[data-listen-seconds]'),
    listenToggle: $('[data-listen-toggle]'),
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
    installPrompt: null,
    listening: {
      active: false,
      paused: false,
      cards: [],
      index: 0,
      cycle: 1,
      sequence: 0,
      wakeLock: null
    }
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
    dom.startListening.disabled = cards.length === 0;
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

  function speechSupported() {
    return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  }

  function koreanVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    const korean = voices.filter((voice) => /^ko(?:-|_)/i.test(voice.lang));
    const preferredNames = ["sora", "sunhi", "yuna", "heami", "google 한국", "korean"];
    return korean.sort((a, b) => {
      const nameA = a.name.toLocaleLowerCase("ko-KR");
      const nameB = b.name.toLocaleLowerCase("ko-KR");
      const preferredA = preferredNames.findIndex((name) => nameA.includes(name));
      const preferredB = preferredNames.findIndex((name) => nameB.includes(name));
      const scoreA = (preferredA < 0 ? 50 : preferredA) + (a.localService ? 0 : 10);
      const scoreB = (preferredB < 0 ? 50 : preferredB) + (b.localService ? 0 : 10);
      return scoreA - scoreB;
    })[0] || voices.find((voice) => voice.default) || null;
  }

  function speechText(value) {
    const numberWords = { "①": "첫째,", "②": "둘째,", "③": "셋째,", "④": "넷째,", "⑤": "다섯째,", "⑥": "여섯째,", "⑦": "일곱째,", "⑧": "여덟째," };
    return String(value || "")
      .replace(/[①②③④⑤⑥⑦⑧]/g, (mark) => numberWords[mark])
      .replace(/NFTC/gi, "엔 에프 티 씨 ")
      .replace(/NFPC/gi, "엔 에프 피 씨 ")
      .replace(/(\d+(?:\.\d+)?)\s*(?:m²|㎡|m2)/gi, "$1 제곱미터")
      .replace(/(\d+(?:\.\d+)?)\s*(?:m³|㎥|m3)/gi, "$1 세제곱미터")
      .replace(/(\d+(?:\.\d+)?)\s*mm\b/gi, "$1 밀리미터")
      .replace(/(\d+(?:\.\d+)?)\s*cm\b/gi, "$1 센티미터")
      .replace(/(\d+(?:\.\d+)?)\s*m\b/gi, "$1 미터")
      .replace(/(\d+(?:\.\d+)?)\s*kg\b/gi, "$1 킬로그램")
      .replace(/(\d+(?:\.\d+)?)\s*kPa\b/gi, "$1 킬로파스칼")
      .replace(/(\d+(?:\.\d+)?)\s*MPa\b/gi, "$1 메가파스칼")
      .replace(/[\/·|]/g, ", ")
      .replace(/[“”"']/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function listenSequenceValid(sequence) {
    return state.listening.active && state.listening.sequence === sequence;
  }

  function renderListenPhase() {
    if (state.listening.paused) {
      dom.listenPhase.textContent = "일시정지됨";
      dom.listenPulse.className = "listen-pulse is-paused";
      dom.listenToggle.textContent = "계속 듣기";
      return;
    }
    dom.listenPhase.textContent = state.listening.phaseText || "문제 듣는 중";
    dom.listenPulse.className = `listen-pulse ${state.listening.phaseMode === "waiting" ? "is-waiting" : "is-speaking"}`;
    dom.listenToggle.textContent = "일시정지";
  }

  function setListenPhase(text, mode = "speaking") {
    state.listening.phaseText = text;
    state.listening.phaseMode = mode;
    renderListenPhase();
  }

  function speakText(text, rate, sequence) {
    return new Promise((resolve) => {
      if (!listenSequenceValid(sequence)) {
        resolve(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(speechText(text));
      const voice = koreanVoice();
      utterance.lang = voice?.lang || "ko-KR";
      if (voice) utterance.voice = voice;
      utterance.rate = rate;
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.onend = () => resolve(listenSequenceValid(sequence));
      utterance.onerror = () => resolve(false);
      window.speechSynthesis.speak(utterance);
    });
  }

  function listenDelay(milliseconds, sequence) {
    return new Promise((resolve) => {
      let remaining = milliseconds;
      let previous = performance.now();
      const tick = () => {
        if (!listenSequenceValid(sequence)) {
          resolve(false);
          return;
        }
        const now = performance.now();
        if (!state.listening.paused) remaining -= now - previous;
        previous = now;
        if (remaining <= 0) {
          resolve(true);
          return;
        }
        setTimeout(tick, Math.min(120, remaining));
      };
      setTimeout(tick, Math.min(120, remaining));
    });
  }

  function renderListenCard() {
    const card = state.listening.cards[state.listening.index];
    if (!card) return;
    const total = state.listening.cards.length;
    dom.listenProgress.textContent = `${state.listening.index + 1} / ${total}`;
    dom.listenProgressBar.style.width = `${((state.listening.index + 1) / total) * 100}%`;
    dom.listenCycle.textContent = `${state.listening.cycle}회차 · ${card.kind}`;
    dom.listenSubject.textContent = card.subject;
    dom.listenQuestion.textContent = card.question;
    dom.listenMnemonic.textContent = card.mnemonic;
    dom.listenMnemonicBox.hidden = true;
    dom.listenCountdown.hidden = true;
  }

  async function playListenAnswer(sequence) {
    if (!listenSequenceValid(sequence)) return;
    const card = state.listening.cards[state.listening.index];
    dom.listenCountdown.hidden = true;
    dom.listenMnemonicBox.hidden = false;
    setListenPhase("니모닉 1번째 듣는 중");
    if (!(await speakText(`니모닉. ${card.mnemonic}`, 0.88, sequence))) return;
    if (!(await listenDelay(650, sequence))) return;
    setListenPhase("니모닉 2번째 듣는 중");
    if (!(await speakText(card.mnemonic, 0.85, sequence))) return;
    if (!(await listenDelay(900, sequence))) return;
    advanceListening();
  }

  async function playListenQuestion(sequence) {
    if (!listenSequenceValid(sequence)) return;
    const card = state.listening.cards[state.listening.index];
    renderListenCard();
    setListenPhase("문제 듣는 중");
    if (!(await speakText(card.question, 0.94, sequence))) return;
    dom.listenCountdown.hidden = false;
    setListenPhase("답을 떠올리는 시간", "waiting");
    for (let seconds = 10; seconds > 0; seconds -= 1) {
      dom.listenSeconds.textContent = seconds;
      if (!(await listenDelay(1000, sequence))) return;
    }
    await playListenAnswer(sequence);
  }

  function advanceListening() {
    if (!state.listening.active) return;
    state.listening.index += 1;
    if (state.listening.index >= state.listening.cards.length) {
      state.listening.index = 0;
      state.listening.cycle += 1;
    }
    state.listening.sequence += 1;
    playListenQuestion(state.listening.sequence);
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try {
      state.listening.wakeLock = await navigator.wakeLock.request("screen");
    } catch {
      state.listening.wakeLock = null;
    }
  }

  function startListening() {
    if (!speechSupported()) {
      showToast("이 브라우저에서는 음성 듣기를 지원하지 않습니다.");
      return;
    }
    const cards = filteredCards().filter((card) => card.hasMnemonic);
    if (!cards.length) {
      showToast("선택한 범위에 니모닉 카드가 없습니다.");
      return;
    }
    stopListening(false);
    state.listening.active = true;
    state.listening.paused = false;
    state.listening.cards = cards;
    state.listening.index = 0;
    state.listening.cycle = 1;
    state.listening.sequence += 1;
    showScreen("listening");
    requestWakeLock();
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    playListenQuestion(state.listening.sequence);
  }

  function stopListening(showHome = true) {
    state.listening.active = false;
    state.listening.paused = false;
    state.listening.sequence += 1;
    if (speechSupported()) window.speechSynthesis.cancel();
    state.listening.wakeLock?.release?.().catch(() => {});
    state.listening.wakeLock = null;
    if (showHome) {
      showScreen("home");
      updateDashboard();
    }
  }

  function toggleListening() {
    if (!state.listening.active) return;
    state.listening.paused = !state.listening.paused;
    if (state.listening.paused) window.speechSynthesis.pause();
    else window.speechSynthesis.resume();
    renderListenPhase();
  }

  function listenAnswerNow() {
    if (!state.listening.active) return;
    state.listening.paused = false;
    state.listening.sequence += 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    renderListenPhase();
    playListenAnswer(state.listening.sequence);
  }

  function listenNext() {
    if (!state.listening.active) return;
    state.listening.paused = false;
    state.listening.sequence += 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    state.listening.index += 1;
    if (state.listening.index >= state.listening.cards.length) {
      state.listening.index = 0;
      state.listening.cycle += 1;
    }
    playListenQuestion(state.listening.sequence);
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
    if (state.listening.active) stopListening(false);
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
    dom.startListening.addEventListener("click", startListening);
    $('[data-stop-listening]').addEventListener("click", () => stopListening(true));
    dom.listenToggle.addEventListener("click", toggleListening);
    $('[data-listen-answer]').addEventListener("click", listenAnswerNow);
    $('[data-listen-next]').addEventListener("click", listenNext);
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
    document.addEventListener("visibilitychange", () => {
      if (state.listening.active && document.visibilityState === "visible" && !state.listening.wakeLock) requestWakeLock();
    });
    window.addEventListener("beforeunload", () => {
      if (speechSupported()) window.speechSynthesis.cancel();
    });
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
