const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const TEAM_NAMES = ["Frontend", "QA", "Game Engine"];
const STORAGE_KEY = "resource-capacity-planner-v2";
const LEGACY_STORAGE_KEY = "resource-capacity-planner-v1";
const PRIORITIES = ["Medium", "High", "Low"];
const EXPERIENCE_LEVELS = ["Junior", "Mid", "Senior", "Lead"];
const TOTAL_CELL_INDEX = 9;
const FIRST_DAY_CELL_INDEX = 4;
const SUPABASE_TABLE = "capacity_plans";
const REMOTE_SAVE_DELAY = 700;
const supabaseSettings = window.CAPACITY_PLANNER_SUPABASE || {};
const remotePlanId = supabaseSettings.planId || "resource-capacity-planner";

const emptyEffort = () => ({ Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0 });

const makeTask = (
  name = "Task 1",
  blocker = "",
  id = crypto.randomUUID(),
  priority = "Medium",
) => ({
  id,
  name,
  priority,
  blocker,
  effort: emptyEffort(),
});

const makeResource = (
  name = "Resource 1",
  tasks = [makeTask()],
  id = crypto.randomUUID(),
  experienceLevel = "Mid",
) => ({
  id,
  name,
  experienceLevel: normalizeExperienceLevel(experienceLevel),
  tasks,
});

const makeWeek = (name = "22nd June - 26th June", resources = [makeResource()], id = crypto.randomUUID()) => ({
  id,
  name,
  resources,
  todoNotes: "",
  upcomingNotes: "",
});

const makeTeam = (name) => {
  const week = makeWeek("22nd June - 26th June", [
    makeResource("Resource 1", [makeTask("Task 1"), makeTask("Task 2")]),
  ]);
  return {
    id: slug(name),
    name,
    activeWeekId: week.id,
    weeks: [week],
  };
};

const seedPlan = {
  activeTeamId: slug(TEAM_NAMES[0]),
  teams: TEAM_NAMES.map(makeTeam),
};

let plan = loadPlan();
const teamSelect = document.querySelector("#teamSelect");
const weekSelect = document.querySelector("#weekSelect");
const plannerBody = document.querySelector("#plannerBody");
const todoNotes = document.querySelector("#todoNotes");
const upcomingNotes = document.querySelector("#upcomingNotes");
const entryDialog = document.querySelector("#entryDialog");
const entryForm = document.querySelector("#entryForm");
const dialogTitle = document.querySelector("#dialogTitle");
const dialogFields = document.querySelector("#dialogFields");
const syncStatus = document.querySelector("#syncStatus");
let supabaseClient = null;
let remoteReady = false;
let remoteSaveTimer = null;
let remoteChannel = null;
let isApplyingRemotePlan = false;

document.querySelector("#addTeam").addEventListener("click", () => openDialog("team"));
document.querySelector("#renameTeam").addEventListener("click", () => openDialog("renameTeam"));
document.querySelector("#addWeek").addEventListener("click", () => openDialog("week"));
document.querySelector("#addResource").addEventListener("click", () => openDialog("resource"));
document.querySelector("#addTask").addEventListener("click", () => openDialog("task"));
document.querySelector("#exportJson").addEventListener("click", exportPlan);
document.querySelector("#resetPlan").addEventListener("click", resetPlan);

todoNotes.addEventListener("input", () => {
  activeWeek().todoNotes = todoNotes.value;
  persist();
});

upcomingNotes.addEventListener("input", () => {
  activeWeek().upcomingNotes = upcomingNotes.value;
  persist();
});

teamSelect.addEventListener("change", () => {
  plan.activeTeamId = teamSelect.value;
  persist();
  render();
});

weekSelect.addEventListener("change", () => {
  activeTeam().activeWeekId = weekSelect.value;
  persist();
  render();
});

entryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(entryForm);
  const mode = entryForm.dataset.mode;

  if (mode === "week") {
    addWeek(String(formData.get("name") || "").trim());
  }

  if (mode === "team") {
    addTeam(String(formData.get("name") || "").trim());
  }

  if (mode === "renameTeam") {
    renameActiveTeam(String(formData.get("name") || "").trim());
  }

  if (mode === "resource") {
    addResource(
      String(formData.get("name") || "").trim(),
      String(formData.get("experienceLevel") || "Mid"),
    );
  }

  if (mode === "task") {
    addTask(
      String(formData.get("resourceId") || ""),
      String(formData.get("name") || "").trim(),
      String(formData.get("priority") || "Medium"),
      String(formData.get("blocker") || "").trim(),
    );
  }

  entryDialog.close();
  persist();
  render();
});

render();
initializeSupabaseSync();

function loadPlan() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return normalizePlan(JSON.parse(stored));
    } catch {
      return structuredClone(seedPlan);
    }
  }

  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacy) {
    try {
      return migrateLegacyPlan(JSON.parse(legacy));
    } catch {
      return structuredClone(seedPlan);
    }
  }

  return structuredClone(seedPlan);
}

function migrateLegacyPlan(legacyPlan) {
  if (!legacyPlan.weeks?.length) return structuredClone(seedPlan);
  const migrated = structuredClone(seedPlan);
  const frontend = migrated.teams[0];
  frontend.weeks = legacyPlan.weeks.map((week) => ({
    id: week.id || crypto.randomUUID(),
    name: week.name || "Week",
    resources: normalizeResources(week.resources || []),
    todoNotes: week.todoNotes || "",
    upcomingNotes: week.upcomingNotes || "",
  }));
  frontend.activeWeekId = legacyPlan.activeWeekId || frontend.weeks[0].id;
  return normalizePlan(migrated);
}

function normalizePlan(candidate) {
  if (!candidate.teams?.length) return structuredClone(seedPlan);

  const teamsById = new Map(candidate.teams.map((team) => [team.id || slug(team.name), team]));
  const defaultTeams = TEAM_NAMES.map((teamName) => {
    const id = slug(teamName);
    const existing = teamsById.get(id);
    if (!existing) return makeTeam(teamName);

    const weeks = existing.weeks?.length
      ? existing.weeks.map((week) => ({
          id: week.id || crypto.randomUUID(),
          name: week.name || "Week",
          resources: normalizeResources(week.resources || []),
          todoNotes: week.todoNotes || "",
          upcomingNotes: week.upcomingNotes || "",
        }))
      : makeTeam(teamName).weeks;

    return {
      id,
      name: existing.name || teamName,
      activeWeekId: existing.activeWeekId || weeks[0].id,
      weeks,
    };
  });
  const defaultIds = new Set(defaultTeams.map((team) => team.id));
  const customTeams = candidate.teams
    .filter((team) => !defaultIds.has(team.id || slug(team.name)))
    .map((team) => {
      const weeks = team.weeks?.length
        ? team.weeks.map((week) => ({
            id: week.id || crypto.randomUUID(),
            name: week.name || "Week",
            resources: normalizeResources(week.resources || []),
            todoNotes: week.todoNotes || "",
            upcomingNotes: week.upcomingNotes || "",
          }))
        : makeTeam(team.name || "New team").weeks;

      return {
        id: team.id || uniqueTeamId(team.name || "New team", candidate.teams),
        name: team.name || "New team",
        activeWeekId: team.activeWeekId || weeks[0].id,
        weeks,
      };
    });
  const normalizedTeams = [...defaultTeams, ...customTeams];

  const activeTeamId = normalizedTeams.some((team) => team.id === candidate.activeTeamId)
    ? candidate.activeTeamId
    : normalizedTeams[0].id;

  return { activeTeamId, teams: normalizedTeams };
}

function normalizeResources(resources) {
  return resources.map((resource) => ({
    id: resource.id || crypto.randomUUID(),
    name: resource.name || "Unnamed resource",
    experienceLevel: normalizeExperienceLevel(resource.experienceLevel),
    tasks: (resource.tasks?.length ? resource.tasks : [makeTask()]).map((task) => ({
      id: task.id || crypto.randomUUID(),
      name: task.name || "Untitled task",
      priority: normalizePriority(task.priority),
      blocker: task.blocker || "",
      effort: { ...emptyEffort(), ...(task.effort || {}) },
    })),
  }));
}

function persist(options = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  if (options.remote === false || isApplyingRemotePlan || !remoteReady) return;
  scheduleRemoteSave();
}

async function initializeSupabaseSync() {
  if (!hasSupabaseConfig()) {
    setSyncStatus("Local only", "");
    return;
  }

  if (!window.supabase?.createClient) {
    setSyncStatus("Supabase unavailable", "error");
    return;
  }

  setSyncStatus("Connecting", "syncing");
  supabaseClient = window.supabase.createClient(supabaseSettings.url, supabaseSettings.anonKey);

  try {
    const { data, error } = await supabaseClient
      .from(SUPABASE_TABLE)
      .select("data, updated_at")
      .eq("id", remotePlanId)
      .maybeSingle();

    if (error) throw error;

    remoteReady = true;

    if (data?.data) {
      applyRemotePlan(data.data);
    } else {
      await saveRemotePlanNow();
    }

    subscribeToRemotePlan();
    setSyncStatus("Synced", "synced");
  } catch (error) {
    console.error("Supabase sync failed", error);
    remoteReady = false;
    setSyncStatus("Local only", "error");
  }
}

function hasSupabaseConfig() {
  return Boolean(
    supabaseSettings.url &&
      supabaseSettings.anonKey &&
      !supabaseSettings.url.includes("your-project") &&
      !supabaseSettings.anonKey.includes("your-anon-key"),
  );
}

function scheduleRemoteSave() {
  clearTimeout(remoteSaveTimer);
  setSyncStatus("Saving", "syncing");
  remoteSaveTimer = setTimeout(() => {
    saveRemotePlanNow();
  }, REMOTE_SAVE_DELAY);
}

async function saveRemotePlanNow() {
  if (!remoteReady || !supabaseClient) return;

  try {
    const { error } = await supabaseClient
      .from(SUPABASE_TABLE)
      .upsert({ id: remotePlanId, data: plan }, { onConflict: "id" });

    if (error) throw error;
    setSyncStatus("Synced", "synced");
  } catch (error) {
    console.error("Supabase save failed", error);
    setSyncStatus("Save failed", "error");
  }
}

function subscribeToRemotePlan() {
  if (!supabaseClient || remoteChannel) return;

  remoteChannel = supabaseClient
    .channel(`capacity-plan-${remotePlanId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: SUPABASE_TABLE,
        filter: `id=eq.${remotePlanId}`,
      },
      (payload) => {
        if (!payload.new?.data) return;
        if (isSamePlan(payload.new.data)) {
          setSyncStatus("Synced", "synced");
          return;
        }
        applyRemotePlan(payload.new.data);
        setSyncStatus("Synced", "synced");
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setSyncStatus("Synced", "synced");
    });
}

function applyRemotePlan(remotePlan) {
  isApplyingRemotePlan = true;
  plan = normalizePlan(remotePlan);
  persist({ remote: false });
  render();
  isApplyingRemotePlan = false;
}

function isSamePlan(candidate) {
  return JSON.stringify(normalizePlan(candidate)) === JSON.stringify(plan);
}

function setSyncStatus(message, state) {
  if (!syncStatus) return;
  syncStatus.textContent = message;
  if (state) {
    syncStatus.dataset.state = state;
  } else {
    delete syncStatus.dataset.state;
  }
}

function activeTeam() {
  return plan.teams.find((team) => team.id === plan.activeTeamId) || plan.teams[0];
}

function activeWeek() {
  const team = activeTeam();
  return team.weeks.find((week) => week.id === team.activeWeekId) || team.weeks[0];
}

function activeWeekIndex() {
  return Math.max(0, activeTeam().weeks.findIndex((week) => week.id === activeWeek().id));
}

function currentAndFutureWeeks() {
  return activeTeam().weeks.slice(activeWeekIndex());
}

function render() {
  renderTeamSelect();
  renderWeekSelect();
  renderPlanner();
  renderNotes();
  renderSummary();
}

function renderTeamSelect() {
  teamSelect.innerHTML = "";
  plan.teams.forEach((team) => {
    const option = document.createElement("option");
    option.value = team.id;
    option.textContent = team.name;
    option.selected = team.id === activeTeam().id;
    teamSelect.append(option);
  });
}

function renderWeekSelect() {
  weekSelect.innerHTML = "";
  activeTeam().weeks.forEach((week) => {
    const option = document.createElement("option");
    option.value = week.id;
    option.textContent = week.name;
    option.selected = week.id === activeWeek().id;
    weekSelect.append(option);
  });
}

function renderPlanner() {
  const week = activeWeek();
  plannerBody.innerHTML = "";

  week.resources.forEach((resource) => {
    resource.tasks.forEach((task, taskIndex) => {
      const row = document.createElement("tr");
      if (taskIndex === 0) {
        row.append(resourceCell(resource));
      } else {
        row.append(blankCell("resource-cell"));
      }

      row.append(textInputCell(task.name, "task-cell", (value) => {
        updateTask(task.id, { name: value || "Untitled task" });
      }));
      row.append(priorityCell(task.priority || "Medium", (value) => {
        updateTask(task.id, { priority: value });
      }));
      row.append(textInputCell(task.blocker || "", "blocker-cell", (value) => {
        updateTask(task.id, { blocker: value });
      }));

      DAYS.forEach((day) => {
        const cell = document.createElement("td");
        const input = document.createElement("input");
        input.className = "inline-input effort-input";
        input.type = "number";
        input.min = "0";
        input.max = "2";
        input.step = "0.1";
        input.value = normalizeNumber(task.effort[day]);
        input.setAttribute("aria-label", `${resource.name} ${task.name} ${day}`);
        input.addEventListener("input", () => {
          task.effort[day] = Number(input.value || 0);
          row.children[TOTAL_CELL_INDEX].textContent = normalizeNumber(sumTask(task));
          persist();
          renderSummary();
          renderResourceTotals(resource);
        });
        cell.append(input);
        row.append(cell);
      });

      row.append(valueCell(sumTask(task)));

      const actionCell = document.createElement("td");
      const removeButton = document.createElement("button");
      removeButton.className = "remove-button";
      removeButton.type = "button";
      removeButton.textContent = "x";
      removeButton.title = "Remove task";
      removeButton.setAttribute("aria-label", `Remove ${task.name}`);
      removeButton.addEventListener("click", () => removeTask(resource.id, task.id));
      actionCell.append(removeButton);
      row.append(actionCell);
      plannerBody.append(row);
    });

    const totalRow = document.createElement("tr");
    totalRow.className = "total-row";
    totalRow.dataset.resourceTotal = resource.id;
    totalRow.append(blankCell("resource-cell"));
    totalRow.append(labelCell("Total"));
    totalRow.append(blankCell("priority-cell"));
    totalRow.append(blankCell("blocker-cell"));
    DAYS.forEach((day) => totalRow.append(capacityCell(sumResourceDay(resource, day))));
    totalRow.append(valueCell(sumResource(resource)));
    totalRow.append(resourceDeleteCell(resource));
    plannerBody.append(totalRow);
  });
}

function renderNotes() {
  const week = activeWeek();
  todoNotes.value = week.todoNotes || "";
  upcomingNotes.value = week.upcomingNotes || "";
}

function renderResourceTotals(resource) {
  const totalRow = plannerBody.querySelector(`[data-resource-total="${resource.id}"]`);
  if (!totalRow) return;

  const cells = [...totalRow.children];
  DAYS.forEach((day, index) => {
    cells[index + FIRST_DAY_CELL_INDEX].replaceWith(capacityCell(sumResourceDay(resource, day)));
  });
  cells[TOTAL_CELL_INDEX].textContent = normalizeNumber(sumResource(resource));
}

function renderSummary() {
  const week = activeWeek();
  const totals = week.resources.flatMap((resource) =>
    DAYS.map((day) => sumResourceDay(resource, day)),
  );
  const weekTotal = totals.reduce((sum, value) => sum + value, 0);
  const avgDaily = totals.length ? weekTotal / totals.length : 0;
  const taskCount = week.resources.reduce((sum, resource) => sum + resource.tasks.length, 0);
  const overTarget = totals.filter((value) => value > 0.7).length;

  document.querySelector("#weekTotal").textContent = normalizeNumber(weekTotal);
  document.querySelector("#weekTotalHours").textContent = `${Math.round(weekTotal * 10)} hrs`;
  document.querySelector("#avgDaily").textContent = normalizeNumber(avgDaily);
  document.querySelector("#overTarget").textContent = String(overTarget);
  document.querySelector("#resourceCount").textContent = String(week.resources.length);
  document.querySelector("#taskCount").textContent = `${taskCount} tasks`;
}

function textInputCell(value, className, onChange) {
  const cell = document.createElement("td");
  cell.className = className;
  const input = document.createElement("input");
  input.className = "inline-input";
  input.value = value;
  input.addEventListener("change", () => {
    onChange(input.value.trim());
    persist();
    render();
  });
  cell.append(input);
  return cell;
}

function resourceCell(resource) {
  const cell = document.createElement("td");
  cell.className = "resource-cell";

  const nameInput = document.createElement("input");
  nameInput.className = "inline-input resource-name-input";
  nameInput.value = resource.name;
  nameInput.addEventListener("change", () => {
    updateResource(resource.id, { name: nameInput.value.trim() || "Unnamed resource" });
    persist();
    render();
  });

  const levelSelect = document.createElement("select");
  levelSelect.className = "inline-input resource-level-select";
  levelSelect.setAttribute("aria-label", `${resource.name} experience level`);
  EXPERIENCE_LEVELS.forEach((level) => {
    const option = document.createElement("option");
    option.value = level;
    option.textContent = level;
    option.selected = level === normalizeExperienceLevel(resource.experienceLevel);
    levelSelect.append(option);
  });
  levelSelect.addEventListener("change", () => {
    updateResource(resource.id, { experienceLevel: levelSelect.value });
    persist();
    render();
  });

  cell.append(nameInput, levelSelect);
  return cell;
}

function priorityCell(value, onChange) {
  const cell = document.createElement("td");
  cell.className = "priority-cell";
  const select = document.createElement("select");
  select.className = `inline-input priority-select priority-${normalizePriority(value).toLowerCase()}`;
  PRIORITIES.forEach((priority) => {
    const option = document.createElement("option");
    option.value = priority;
    option.textContent = priority;
    option.selected = priority === normalizePriority(value);
    select.append(option);
  });
  select.addEventListener("change", () => {
    select.className = `inline-input priority-select priority-${select.value.toLowerCase()}`;
    onChange(select.value);
    persist();
  });
  cell.append(select);
  return cell;
}

function blankCell(className = "") {
  const cell = document.createElement("td");
  cell.className = className;
  return cell;
}

function labelCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  return cell;
}

function valueCell(value) {
  const cell = document.createElement("td");
  cell.textContent = normalizeNumber(value);
  return cell;
}

function capacityCell(value) {
  const cell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `capacity ${capacityClass(value)}`;
  badge.textContent = normalizeNumber(value);
  cell.append(badge);
  return cell;
}

function resourceDeleteCell(resource) {
  const cell = document.createElement("td");
  const removeButton = document.createElement("button");
  removeButton.className = "remove-button";
  removeButton.type = "button";
  removeButton.textContent = "x";
  removeButton.title = "Remove resource";
  removeButton.setAttribute("aria-label", `Remove ${resource.name}`);
  removeButton.addEventListener("click", () => removeResource(resource.id));
  cell.append(removeButton);
  return cell;
}

function capacityClass(value) {
  if (value > 0.8) return "hot";
  if (value > 0.7) return "warn";
  return "ok";
}

function normalizeNumber(value) {
  const rounded = Math.round(Number(value || 0) * 10) / 10;
  return rounded.toFixed(1);
}

function sumTask(task) {
  return DAYS.reduce((sum, day) => sum + Number(task.effort[day] || 0), 0);
}

function sumResourceDay(resource, day) {
  return resource.tasks.reduce((sum, task) => sum + Number(task.effort[day] || 0), 0);
}

function sumResource(resource) {
  return DAYS.reduce((sum, day) => sum + sumResourceDay(resource, day), 0);
}

function openDialog(mode) {
  entryForm.dataset.mode = mode;
  dialogFields.innerHTML = "";

  if (mode === "week") {
    dialogTitle.textContent = "Add week";
    dialogFields.append(field("Week name", "name", nextWeekName(), true));
  }

  if (mode === "team") {
    dialogTitle.textContent = "Add team";
    dialogFields.append(field("Team name", "name", nextTeamName(), true));
  }

  if (mode === "renameTeam") {
    dialogTitle.textContent = "Rename team";
    dialogFields.append(field("Team name", "name", activeTeam().name, true));
    dialogFields.append(teamDangerZone());
  }

  if (mode === "resource") {
    dialogTitle.textContent = "Add resource";
    dialogFields.append(field("Resource name", "name", `Resource ${activeWeek().resources.length + 1}`, true));
    dialogFields.append(experienceLevelField());
  }

  if (mode === "task") {
    dialogTitle.textContent = "Add task";
    dialogFields.append(resourceField());
    dialogFields.append(field("Task name", "name", "New task", true));
    dialogFields.append(priorityField());
    dialogFields.append(field("Dependency / blocker", "blocker", "", false));
  }

  entryDialog.showModal();
}

function field(labelText, name, value, required) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.name = name;
  input.value = value;
  input.required = required;
  label.append(input);
  return label;
}

function resourceField() {
  const label = document.createElement("label");
  label.textContent = "Resource";
  const select = document.createElement("select");
  select.name = "resourceId";
  activeWeek().resources.forEach((resource) => {
    const option = document.createElement("option");
    option.value = resource.id;
    option.textContent = resource.name;
    select.append(option);
  });
  label.append(select);
  return label;
}

function priorityField() {
  const label = document.createElement("label");
  label.textContent = "Priority";
  const select = document.createElement("select");
  select.name = "priority";
  PRIORITIES.forEach((priority) => {
    const option = document.createElement("option");
    option.value = priority;
    option.textContent = priority;
    option.selected = priority === "Medium";
    select.append(option);
  });
  label.append(select);
  return label;
}

function experienceLevelField() {
  const label = document.createElement("label");
  label.textContent = "Experience level";
  const select = document.createElement("select");
  select.name = "experienceLevel";
  EXPERIENCE_LEVELS.forEach((level) => {
    const option = document.createElement("option");
    option.value = level;
    option.textContent = level;
    option.selected = level === "Mid";
    select.append(option);
  });
  label.append(select);
  return label;
}

function teamDangerZone() {
  const wrapper = document.createElement("div");
  wrapper.className = "danger-zone";

  const note = document.createElement("span");
  note.textContent = "Team settings";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "link-danger";
  button.textContent = "Remove this team";
  button.addEventListener("click", removeActiveTeam);

  wrapper.append(note, button);
  return wrapper;
}

function removeActiveTeam() {
  const team = activeTeam();
  if (plan.teams.length <= 1) {
    alert("At least one team is required.");
    return;
  }

  const confirmed = confirm(`Remove "${team.name}" and all of its weeks, resources, tasks, and notes?`);
  if (!confirmed) return;

  const teamIndex = plan.teams.findIndex((item) => item.id === team.id);
  plan.teams = plan.teams.filter((item) => item.id !== team.id);
  const nextTeam = plan.teams[Math.max(0, teamIndex - 1)] || plan.teams[0];
  plan.activeTeamId = nextTeam.id;
  entryDialog.close();
  persist();
  render();
}

function addWeek(name) {
  if (!name) return;
  const week = cloneWeekStructure(activeWeek(), name);
  activeTeam().weeks.push(week);
  activeTeam().activeWeekId = week.id;
}

function addTeam(name) {
  if (!name) return;
  const team = makeTeam(name);
  team.id = uniqueTeamId(name, plan.teams);
  plan.teams.push(team);
  plan.activeTeamId = team.id;
}

function renameActiveTeam(name) {
  if (!name) return;
  activeTeam().name = name;
}

function cloneWeekStructure(week, name) {
  return {
    id: crypto.randomUUID(),
    name,
    resources: week.resources.map((resource) => ({
      id: resource.id,
      name: resource.name,
      experienceLevel: normalizeExperienceLevel(resource.experienceLevel),
      tasks: resource.tasks.map((task) => ({
        id: task.id,
        name: task.name,
        priority: normalizePriority(task.priority),
        blocker: task.blocker,
        effort: emptyEffort(),
      })),
    })),
    todoNotes: "",
    upcomingNotes: "",
  };
}

function addResource(name, experienceLevel) {
  if (!name) return;
  const resourceId = crypto.randomUUID();
  const taskId = crypto.randomUUID();

  currentAndFutureWeeks().forEach((week) => {
    week.resources.push(makeResource(name, [makeTask("Task 1", "", taskId)], resourceId, experienceLevel));
  });
}

function addTask(resourceId, name, priority, blocker) {
  if (!name) return;
  const taskId = crypto.randomUUID();

  currentAndFutureWeeks().forEach((week) => {
    const resource = week.resources.find((item) => item.id === resourceId);
    if (!resource) return;
    resource.tasks.push(makeTask(name, blocker, taskId, priority));
  });
}

function removeTask(resourceId, taskId) {
  currentAndFutureWeeks().forEach((week) => {
    const resource = week.resources.find((item) => item.id === resourceId);
    if (!resource) return;
    resource.tasks = resource.tasks.filter((task) => task.id !== taskId);
    if (!resource.tasks.length) {
      week.resources = week.resources.filter((item) => item.id !== resourceId);
    }
  });
  persist();
  render();
}

function removeResource(resourceId) {
  currentAndFutureWeeks().forEach((week) => {
    week.resources = week.resources.filter((resource) => resource.id !== resourceId);
  });
  persist();
  render();
}

function updateResource(resourceId, updates) {
  currentAndFutureWeeks().forEach((week) => {
    const resource = week.resources.find((item) => item.id === resourceId);
    if (resource) Object.assign(resource, updates);
  });
}

function updateTask(taskId, updates) {
  currentAndFutureWeeks().forEach((week) => {
    week.resources.forEach((resource) => {
      const task = resource.tasks.find((item) => item.id === taskId);
      if (task) Object.assign(task, updates);
    });
  });
}

function resetPlan() {
  if (!confirm("Reset all teams and weeks to the starter data?")) return;
  plan = structuredClone(seedPlan);
  persist();
  render();
}

function exportPlan() {
  const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "resource-capacity-plan.json";
  link.click();
  URL.revokeObjectURL(url);
}

function nextWeekName() {
  const now = new Date();
  const monday = new Date(now);
  const day = monday.getDay() || 7;
  monday.setDate(monday.getDate() + (8 - day));
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return `${formatDate(monday)} - ${formatDate(friday)}`;
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function normalizePriority(value) {
  return PRIORITIES.includes(value) ? value : "Medium";
}

function normalizeExperienceLevel(value) {
  return EXPERIENCE_LEVELS.includes(value) ? value : "Mid";
}

function uniqueTeamId(name, teams) {
  const base = slug(name) || "team";
  const usedIds = new Set((teams || []).map((team) => team.id).filter(Boolean));
  if (!usedIds.has(base)) return base;

  let index = 2;
  while (usedIds.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function nextTeamName() {
  return `Team ${plan.teams.length + 1}`;
}
