const state = {
  projects: [],
  busyProjectId: null,
};

const elements = {
  projectGrid: document.getElementById("projectGrid"),
  consoleOutput: document.getElementById("consoleOutput"),
  storageContent: document.getElementById("storageContent"),
  projectCountLabel: document.getElementById("projectCountLabel"),
  runningCountLabel: document.getElementById("runningCountLabel"),
  settingsPathLabel: document.getElementById("settingsPathLabel"),
  refreshAllBtn: document.getElementById("refreshAllBtn"),
  portStopInput: document.getElementById("portStopInput"),
  stopPortBtn: document.getElementById("stopPortBtn"),
};

const vscodeIcon = `
  <svg class="vscode-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M17.7 2.4 9.6 9.7 5.1 6.2 2.5 8.4 7 12l-4.5 3.6 2.6 2.2 4.5-3.5 8.1 7.3 3.8-1.9V4.3l-3.8-1.9Zm0 5.3v8.6L12.5 12l5.2-4.3Z" />
  </svg>
`;

function vscodeButton(projectId, disabled = false) {
  return `
    <button
      class="vscode-btn"
      type="button"
      data-action="open-vscode"
      data-project-id="${projectId}"
      aria-label="Open project in Visual Studio Code"
      title="Open in Visual Studio Code"
      ${disabled ? "disabled" : ""}
    >
      ${vscodeIcon}
      <span>VS Code</span>
    </button>
  `;
}

function formatHealth(project) {
  return project.health.running
    ? `Running${project.health.statusCode ? ` · ${project.health.statusCode}` : ""}`
    : "Offline";
}

function setConsoleOutput(text) {
  elements.consoleOutput.textContent = text || "No actions yet.";
}

function updateMetrics(settingsPath) {
  const runningCount = state.projects.filter(
    (project) => project.health.running,
  ).length;
  elements.projectCountLabel.textContent = String(state.projects.length);
  elements.runningCountLabel.textContent = String(runningCount);
  elements.settingsPathLabel.textContent = settingsPath;
}

function renderProjects() {
  elements.projectGrid.innerHTML = "";

  const storageProjects = state.projects.filter(function (p) {
    return p.type === "storage";
  });
  const regularProjects = state.projects.filter(function (p) {
    return p.type !== "storage";
  });

  regularProjects.forEach((project) => {
    const card = document.createElement("article");
    card.className = `project-card project-card--${project.id}`;

    const isBusy = state.busyProjectId === project.id;
    const isRunning = project.health.running;
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
        <div class="project-header-actions">
          ${vscodeButton(project.id, isBusy)}
          <button class="primary-btn" type="button" data-action="open" data-project-id="${project.id}" ${!isRunning ? "disabled" : ""}>Open site</button>
        </div>
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
        <button class="secondary-btn" type="button" data-action="start" data-project-id="${project.id}" ${isBusy || isRunning ? "disabled" : ""}>Start</button>
        <button class="secondary-btn" type="button" data-action="stop" data-project-id="${project.id}" ${isBusy || !isRunning ? "disabled" : ""}>Stop</button>
        <button class="ghost-btn" type="button" data-action="restart" data-project-id="${project.id}" ${isBusy || !isRunning ? "disabled" : ""}>Restart</button>
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
          if (target.type === "storage") {
            window.open(
              "/storage-explorer.html?projectId=" +
                encodeURIComponent(target.id),
              "_blank",
              "noopener,noreferrer",
            );
          } else {
            window.open(target.url, "_blank", "noopener,noreferrer");
          }
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

  if (storageProjects.length > 0) {
    renderStorageCard(storageProjects);
  }
}

function renderStorageCard(storageProjects) {
  var rows = storageProjects
    .map(function (p, i) {
      var desc =
        (p.description || "").length > 80
          ? p.description.slice(0, 80) + "..."
          : p.description || "";
      return (
        "<tr>" +
        "<td>" +
        (i + 1) +
        "</td>" +
        "<td>" +
        (p.githubRepo || p.repoName || "") +
        "</td>" +
        '<td class="storage-desc">' +
        desc +
        "</td>" +
        '<td class="storage-actions">' +
        vscodeButton(p.id, state.busyProjectId === p.id) +
        "</td>" +
        "</tr>"
      );
    })
    .join("");

  elements.storageContent.innerHTML =
    '<div class="storage-table-wrap">' +
    '<table class="storage-table">' +
    "<thead><tr><th>#</th><th>Github</th><th>Description</th><th>Editor</th></tr></thead>" +
    "<tbody>" +
    rows +
    "</tbody>" +
    "</table>" +
    "</div>" +
    '<div class="button-row" style="margin-top:12px">' +
    '<button class="primary-btn" type="button" id="openStorageBtn">Open Storage Explorer</button>' +
    "</div>";

  elements.storageContent
    .querySelector("#openStorageBtn")
    .addEventListener("click", function () {
      window.open("/storage-explorer.html", "_blank", "noopener,noreferrer");
    });

  elements.storageContent
    .querySelectorAll('[data-action="open-vscode"]')
    .forEach(function (button) {
      button.addEventListener("click", function () {
        runProjectAction(button.dataset.projectId, "open-vscode");
      });
    });
}

async function fetchProjects() {
  const response = await fetch("/api/projects");
  const payload = await response.json();
  state.projects = payload.projects;
  updateMetrics(payload.settingsPath);
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
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action }),
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || `Failed to ${action}`);
    }

    state.projects = state.projects.map((project) =>
      project.id === projectId ? payload.project : project,
    );

    setConsoleOutput(payload.output || `${action} completed.`);
  } catch (error) {
    setConsoleOutput(error.message || `Failed to ${action}.`);
  } finally {
    state.busyProjectId = null;
    await fetchProjects();
  }
}

function updatePortStopButton() {
  const rawValue = elements.portStopInput.value.trim();
  const parsedValue = Number(rawValue);
  const isValidPort =
    /^\d+$/.test(rawValue) &&
    Number.isInteger(parsedValue) &&
    parsedValue >= 1 &&
    parsedValue <= 65535;
  elements.stopPortBtn.disabled = !isValidPort;
}

async function stopPort() {
  const rawValue = elements.portStopInput.value.trim();
  const parsedValue = Number(rawValue);
  const isValidPort =
    /^\d+$/.test(rawValue) &&
    Number.isInteger(parsedValue) &&
    parsedValue >= 1 &&
    parsedValue <= 65535;

  if (!isValidPort) {
    return;
  }

  const confirmed = window.confirm(`Do you want to stop port ${parsedValue}?`);
  if (!confirmed) {
    return;
  }

  setConsoleOutput(`Stopping port ${parsedValue}...`);

  try {
    const response = await fetch("/api/ports/stop", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ port: parsedValue }),
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || `Failed to stop port ${parsedValue}`);
    }

    elements.portStopInput.value = "";
    updatePortStopButton();
    setConsoleOutput(payload.message || `Stopped port ${parsedValue}.`);
  } catch (error) {
    setConsoleOutput(error.message || `Failed to stop port ${parsedValue}.`);
  }
}

async function bootstrap() {
  elements.refreshAllBtn.addEventListener("click", fetchProjects);
  elements.portStopInput.addEventListener("input", updatePortStopButton);
  elements.stopPortBtn.addEventListener("click", stopPort);
  updatePortStopButton();
  await fetchProjects();
}

bootstrap().catch((error) => {
  setConsoleOutput(error.message || "Failed to load Learning Hub.");
});
