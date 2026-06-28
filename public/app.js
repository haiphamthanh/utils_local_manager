const state = {
  projects: [],
  busyProjectId: null
};

const elements = {
  projectGrid: document.getElementById("projectGrid"),
  consoleOutput: document.getElementById("consoleOutput"),
  projectCountLabel: document.getElementById("projectCountLabel"),
  runningCountLabel: document.getElementById("runningCountLabel"),
  settingsPathLabel: document.getElementById("settingsPathLabel"),
  resourcesRootLabel: document.getElementById("resourcesRootLabel"),
  refreshAllBtn: document.getElementById("refreshAllBtn")
};

function formatHealth(project) {
  return project.health.running
    ? `Running${project.health.statusCode ? ` · ${project.health.statusCode}` : ""}`
    : "Offline";
}

function setConsoleOutput(text) {
  elements.consoleOutput.textContent = text || "No actions yet.";
}

function updateMetrics(settingsPath, resourcesRoot) {
  const runningCount = state.projects.filter((project) => project.health.running).length;
  elements.projectCountLabel.textContent = String(state.projects.length);
  elements.runningCountLabel.textContent = String(runningCount);
  elements.settingsPathLabel.textContent = settingsPath;
  elements.resourcesRootLabel.textContent = resourcesRoot;
}

function renderProjects() {
  elements.projectGrid.innerHTML = "";

  state.projects.forEach((project) => {
    const card = document.createElement("article");
    card.className = `project-card project-card--${project.id}`;

    const isBusy = state.busyProjectId === project.id;
    const gitState = project.git.exists
      ? `${project.git.branch || project.branch || "unknown"}${project.git.commit ? ` · ${project.git.commit}` : ""}`
      : "Not cloned";
    const dirtyState = project.git.dirty ? "Local changes" : "Clean";

    card.innerHTML = `
      <div class="project-header">
        <div>
          <h3>${project.title}</h3>
          <p class="project-subtitle">${project.subtitle}</p>
        </div>
        <button class="primary-btn" type="button" data-action="open" data-project-id="${project.id}">Open site</button>
      </div>

      <p class="project-description">${project.description}</p>

      <div class="status-cluster">
        <span class="pill ${project.health.running ? "ok" : "down"}">${formatHealth(project)}</span>
        <span class="pill">${project.host}:${project.port}</span>
        <span class="pill">${gitState}</span>
      </div>

      <div class="tag-row">
        ${project.tags.map((tag) => `<span>${tag}</span>`).join("")}
      </div>

      <div class="meta-grid">
        <div class="meta-item">
          <span class="meta-key">GitHub</span>
          <span class="meta-value">${project.githubRepo}</span>
        </div>
        <div class="meta-item">
          <span class="meta-key">Working tree</span>
          <span class="meta-value">${dirtyState}</span>
        </div>
        <div class="meta-item">
          <span class="meta-key">Start script</span>
          <span class="meta-value">${project.scripts.start}</span>
        </div>
        <div class="meta-item">
          <span class="meta-key">Stop script</span>
          <span class="meta-value">${project.scripts.stop}</span>
        </div>
      </div>

      <div class="path-chip">${project.resourceDir}</div>

      <div class="button-row">
        <button class="secondary-btn" type="button" data-action="sync" data-project-id="${project.id}" ${isBusy ? "disabled" : ""}>Sync with gh</button>
        <button class="secondary-btn" type="button" data-action="start" data-project-id="${project.id}" ${isBusy ? "disabled" : ""}>Start</button>
        <button class="secondary-btn" type="button" data-action="stop" data-project-id="${project.id}" ${isBusy ? "disabled" : ""}>Stop</button>
        <button class="ghost-btn" type="button" data-action="restart" data-project-id="${project.id}" ${isBusy ? "disabled" : ""}>Restart</button>
      </div>
    `;

    card.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) {
        return;
      }

      const action = button.dataset.action;
      const projectId = button.dataset.projectId;

      if (action === "open") {
        const target = state.projects.find((item) => item.id === projectId);
        if (target) {
          window.open(target.url, "_blank", "noopener,noreferrer");
        }
        return;
      }

      if (!projectId || isBusy) {
        return;
      }

      await runProjectAction(projectId, action);
    });

    elements.projectGrid.appendChild(card);
  });
}

async function fetchProjects() {
  const response = await fetch("/api/projects");
  const payload = await response.json();
  state.projects = payload.projects;
  updateMetrics(payload.settingsPath, payload.resourcesRoot);
  renderProjects();
}

async function runProjectAction(projectId, action) {
  state.busyProjectId = projectId;
  renderProjects();
  setConsoleOutput(`Running ${action} on ${projectId}...`);

  try {
    const response = await fetch(`/api/projects/${projectId}/actions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action })
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || `Failed to ${action}`);
    }

    state.projects = state.projects.map((project) =>
      project.id === projectId ? payload.project : project
    );

    setConsoleOutput(payload.output || `${action} completed.`);
  } catch (error) {
    setConsoleOutput(error.message || `Failed to ${action}.`);
  } finally {
    state.busyProjectId = null;
    await fetchProjects();
  }
}

async function bootstrap() {
  elements.refreshAllBtn.addEventListener("click", fetchProjects);
  await fetchProjects();
}

bootstrap().catch((error) => {
  setConsoleOutput(error.message || "Failed to load Learning Hub.");
});
