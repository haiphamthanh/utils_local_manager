const state = {
  apps: [],
  activeAppId: localStorage.getItem("learning-hub.active-app") || "jlpt",
  splitView: localStorage.getItem("learning-hub.split-view") === "true"
};

const elements = {
  tabList: document.getElementById("tabList"),
  statusGrid: document.getElementById("statusGrid"),
  contentGrid: document.getElementById("contentGrid"),
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
  refreshBtn: document.getElementById("refreshBtn"),
  openBtn: document.getElementById("openBtn")
};

function getActiveApp() {
  return state.apps.find((app) => app.id === state.activeAppId) || state.apps[0];
}

function getSecondaryApp() {
  return state.apps.find((app) => app.id !== state.activeAppId);
}

function updateFrame(frame, fallback, app) {
  frame.src = app.url;
  fallback.classList.add("hidden");

  const timeoutId = setTimeout(() => {
    fallback.innerHTML = `
      <div>
        <h3>Embedded view may be blocked</h3>
        <p>
          If this app sets frame restrictions, open it in a separate tab or move to a reverse-proxy setup under the Learning Hub host.
        </p>
      </div>
    `;
    fallback.classList.remove("hidden");
  }, 3000);

  frame.onload = () => {
    clearTimeout(timeoutId);
    fallback.classList.add("hidden");
  };
}

function renderTabs() {
  elements.tabList.innerHTML = "";

  state.apps.forEach((app) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab-btn${app.id === state.activeAppId ? " active" : ""}`;
    button.innerHTML = `<strong>${app.title}</strong><span>${app.subtitle}</span>`;
    button.addEventListener("click", () => {
      state.activeAppId = app.id;
      localStorage.setItem("learning-hub.active-app", app.id);
      render();
    });
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
                <p>${app.url}</p>
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
                <p>${app.url}</p>
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

function renderToolbar() {
  const activeApp = getActiveApp();
  elements.toggleSplitBtn.textContent = state.splitView ? "Single view" : "Split view";
  elements.openBtn.onclick = () => window.open(activeApp.url, "_blank", "noopener,noreferrer");
  elements.refreshBtn.onclick = () => {
    const currentSrc = elements.primaryFrame.src;
    elements.primaryFrame.src = "about:blank";
    requestAnimationFrame(() => {
      elements.primaryFrame.src = currentSrc;
    });
  };
  elements.toggleSplitBtn.onclick = () => {
    state.splitView = !state.splitView;
    localStorage.setItem("learning-hub.split-view", String(state.splitView));
    renderFrames();
    renderToolbar();
  };
}

function render() {
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
}

bootstrap().catch((error) => {
  console.error("Failed to load Learning Hub", error);
});
