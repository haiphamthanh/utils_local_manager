const APP_DETAILS = {
  jlpt: {
    kicker: "Deep reading",
    summary: "Use this room when you want deliberate, lesson-based progress with enough space to read, manage, and review material.",
    tags: ["Daily lessons", "Structured reading", "Long-form study"]
  },
  roadmap: {
    kicker: "Fast repetition",
    summary: "Use this room when you want speed, rhythm, and one-word-at-a-time repetition without distraction from larger lesson structures.",
    tags: ["Single-word drill", "Roadmap review", "Quick recall"]
  }
};

const state = {
  apps: [],
  activeAppId: localStorage.getItem("learning-hub.active-app") || "jlpt",
  splitView: localStorage.getItem("learning-hub.split-view") === "true",
  focusMode: localStorage.getItem("learning-hub.focus-mode") === "true"
};

const elements = {
  appGrid: document.getElementById("appGrid"),
  tabList: document.getElementById("tabList"),
  statusGrid: document.getElementById("statusGrid"),
  contentGrid: document.getElementById("contentGrid"),
  panelTitle: document.getElementById("panelTitle"),
  activeTrackLabel: document.getElementById("activeTrackLabel"),
  viewModeLabel: document.getElementById("viewModeLabel"),
  todayLabel: document.getElementById("todayLabel"),
  primaryTitle: document.getElementById("primaryTitle"),
  primarySubtitle: document.getElementById("primarySubtitle"),
  primaryUrl: document.getElementById("primaryUrl"),
  primaryFrame: document.getElementById("primaryFrame"),
  primaryFallback: document.getElementById("primaryFallback"),
  secondaryCard: document.getElementById("secondaryCard"),
  secondaryTitle: document.getElementById("secondaryTitle"),
  secondarySubtitle: document.getElementById("secondarySubtitle"),
  secondaryUrl: document.getElementById("secondaryUrl"),
  secondaryFrame: document.getElementById("secondaryFrame"),
  secondaryFallback: document.getElementById("secondaryFallback"),
  toggleSplitBtn: document.getElementById("toggleSplitBtn"),
  toggleFocusBtn: document.getElementById("toggleFocusBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  openBtn: document.getElementById("openBtn")
};

function getActiveApp() {
  return state.apps.find((app) => app.id === state.activeAppId) || state.apps[0];
}

function getSecondaryApp() {
  return state.apps.find((app) => app.id !== state.activeAppId);
}

function getAppDetails(appId) {
  return APP_DETAILS[appId] || {
    kicker: "Study app",
    summary: "A focused study environment available inside the Learning Hub.",
    tags: ["Embedded app"]
  };
}

function setActiveApp(appId) {
  state.activeAppId = appId;
  localStorage.setItem("learning-hub.active-app", appId);
  render();
}

function formatTodayLabel() {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(new Date());
}

function toggleFocusMode() {
  state.focusMode = !state.focusMode;
  localStorage.setItem("learning-hub.focus-mode", String(state.focusMode));
  document.body.classList.toggle("focus-mode", state.focusMode);
  renderToolbar();
}

function toggleSplitView() {
  state.splitView = !state.splitView;
  localStorage.setItem("learning-hub.split-view", String(state.splitView));
  render();
}

function buildFallbackMessage(app) {
  return `
    <div class="fallback-inner">
      <h3>${app.title} did not render in the hub</h3>
      <p>
        If this app blocks framing or is still booting, open it in a separate tab for now and keep the hub as your launch surface.
      </p>
    </div>
  `;
}

function updateFrame(frame, fallback, app) {
  frame.src = app.url;
  fallback.classList.add("hidden");

  const timeoutId = setTimeout(() => {
    fallback.innerHTML = buildFallbackMessage(app);
    fallback.classList.remove("hidden");
  }, 3000);

  frame.onload = () => {
    clearTimeout(timeoutId);
    fallback.classList.add("hidden");
  };
}

function renderHeroMetrics() {
  const activeApp = getActiveApp();
  elements.activeTrackLabel.textContent = activeApp.title;
  elements.viewModeLabel.textContent = state.splitView ? "Split view" : "Single view";
  elements.todayLabel.textContent = formatTodayLabel();
}

function renderDiscoveryCards() {
  elements.appGrid.innerHTML = "";

  state.apps.forEach((app) => {
    const details = getAppDetails(app.id);
    const article = document.createElement("article");
    article.className = `app-card app-card--${app.id}${app.id === state.activeAppId ? " active" : ""}`;

    article.innerHTML = `
      <div class="app-card-top">
        <div>
          <span class="app-kicker">${details.kicker}</span>
          <h3>${app.title}</h3>
        </div>
        <span class="frame-url">${app.url}</span>
      </div>
      <p class="app-summary">${details.summary}</p>
      <div class="app-tags">
        ${details.tags.map((tag) => `<span>${tag}</span>`).join("")}
      </div>
      <div class="app-actions">
        <button class="primary-btn" type="button" data-action="activate" data-app-id="${app.id}">Enter workspace</button>
        <button class="ghost-btn" type="button" data-action="open" data-app-id="${app.id}">Open original</button>
      </div>
    `;

    article.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      if (!target) {
        setActiveApp(app.id);
        return;
      }

      const action = target.dataset.action;
      if (action === "activate") {
        setActiveApp(app.id);
        document.querySelector(".workspace-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      if (action === "open") {
        window.open(app.url, "_blank", "noopener,noreferrer");
      }
    });

    elements.appGrid.appendChild(article);
  });
}

function renderTabs() {
  elements.tabList.innerHTML = "";

  state.apps.forEach((app, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.className = `tab-btn${app.id === state.activeAppId ? " active" : ""}`;
    button.innerHTML = `
      <strong>${index + 1}. ${app.title}</strong>
      <span>${app.subtitle}</span>
    `;
    button.addEventListener("click", () => setActiveApp(app.id));
    elements.tabList.appendChild(button);
  });
}

async function renderStatuses() {
  const cards = await Promise.all(
    state.apps.map(async (app) => {
      try {
        const response = await fetch(`/api/health/${app.id}`);
        const health = await response.json();
        const statusText = health.ok ? "Running" : "Offline";
        const statusClass = health.ok ? "ok" : "down";

        return `
          <div class="status-card">
            <div class="status-row">
              <div>
                <strong>${app.title}</strong>
                <p>${app.subtitle}</p>
              </div>
              <span class="status-pill ${statusClass}">${statusText}</span>
            </div>
          </div>
        `;
      } catch {
        return `
          <div class="status-card">
            <div class="status-row">
              <div>
                <strong>${app.title}</strong>
                <p>${app.subtitle}</p>
              </div>
              <span class="status-pill down">Unknown</span>
            </div>
          </div>
        `;
      }
    })
  );

  elements.statusGrid.innerHTML = cards.join("");
}

function renderFrames() {
  const activeApp = getActiveApp();
  const secondaryApp = getSecondaryApp();

  elements.panelTitle.textContent = `${activeApp.title} Workspace`;
  elements.primaryTitle.textContent = activeApp.title;
  elements.primarySubtitle.textContent = activeApp.subtitle;
  elements.primaryUrl.textContent = activeApp.url;
  updateFrame(elements.primaryFrame, elements.primaryFallback, activeApp);

  elements.contentGrid.classList.toggle("split", state.splitView);
  elements.secondaryCard.classList.toggle("hidden", !state.splitView);

  if (state.splitView && secondaryApp) {
    elements.secondaryTitle.textContent = secondaryApp.title;
    elements.secondarySubtitle.textContent = secondaryApp.subtitle;
    elements.secondaryUrl.textContent = secondaryApp.url;
    updateFrame(elements.secondaryFrame, elements.secondaryFallback, secondaryApp);
  }
}

function refreshPrimaryFrame() {
  const currentSrc = elements.primaryFrame.src;
  elements.primaryFrame.src = "about:blank";
  requestAnimationFrame(() => {
    elements.primaryFrame.src = currentSrc;
  });
}

function renderToolbar() {
  const activeApp = getActiveApp();

  document.body.classList.toggle("focus-mode", state.focusMode);

  elements.toggleSplitBtn.textContent = state.splitView ? "Single view" : "Split view";
  elements.toggleFocusBtn.textContent = state.focusMode ? "Exit focus" : "Focus mode";

  elements.openBtn.onclick = () => window.open(activeApp.url, "_blank", "noopener,noreferrer");
  elements.refreshBtn.onclick = refreshPrimaryFrame;
  elements.toggleSplitBtn.onclick = toggleSplitView;
  elements.toggleFocusBtn.onclick = toggleFocusMode;
}

function handleShortcuts(event) {
  if (event.target.closest("input, textarea, select")) {
    return;
  }

  const key = event.key.toLowerCase();

  if (key === "1" && state.apps[0]) {
    setActiveApp(state.apps[0].id);
  } else if (key === "2" && state.apps[1]) {
    setActiveApp(state.apps[1].id);
  } else if (key === "r") {
    refreshPrimaryFrame();
  } else if (key === "s") {
    toggleSplitView();
  } else if (key === "f") {
    toggleFocusMode();
  }
}

function render() {
  renderHeroMetrics();
  renderDiscoveryCards();
  renderTabs();
  renderFrames();
  renderToolbar();
}

async function bootstrap() {
  const response = await fetch("/api/apps");
  const payload = await response.json();
  state.apps = payload.apps;

  if (!state.apps.some((app) => app.id === state.activeAppId)) {
    state.activeAppId = state.apps[0].id;
  }

  render();
  renderStatuses();
  document.addEventListener("keydown", handleShortcuts);
}

bootstrap().catch((error) => {
  console.error("Failed to load Learning Hub", error);
});
