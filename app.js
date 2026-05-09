const READ_STORAGE_KEY = "hocknull.read";
const VIEW_STORAGE_KEY = "hocknull.view";

const state = {
  videos: [],
  fullVideos: new Map(),
  selected: null,
  read: loadReadSet(),
  view: loadView(),
  allPoints: null,
  pointLoadErrors: [],
  pointsLoading: false,
};

const els = {
  status: document.querySelector("#status"),
  search: document.querySelector("#search"),
  topic: document.querySelector("#topic"),
  clearFilters: document.querySelector("#clearFilters"),
  videoList: document.querySelector("#videoList"),
  details: document.querySelector("#details"),
  videosView: document.querySelector("#videosView"),
  pointsView: document.querySelector("#pointsView"),
  viewTabs: document.querySelectorAll(".view-tab"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Kunne ikke laste ${path}`);
  }
  return response.json();
}

function topicLabel(topic) {
  const labels = {
    "hoyre-hand": "høyre hånd",
    "venstre-hand": "venstre hånd",
    kolleflate: "kølleflate",
    kollehode: "køllehode",
    "ujevnt-leie": "ujevnt leie",
  };
  return labels[topic] || String(topic).replaceAll("-", " ");
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replaceAll("æ", "ae")
    .replaceAll("ø", "o")
    .replaceAll("å", "a")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreFields(fields, terms) {
  if (!terms.length) return 0;
  let score = 0;
  for (const term of terms) {
    let matched = false;
    for (const field of fields) {
      if (field.text.includes(term)) {
        score += field.weight;
        matched = true;
      }
    }
    if (!matched) return -1;
  }
  return score;
}

function loadReadSet() {
  try {
    const raw = localStorage.getItem(READ_STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveReadSet() {
  try {
    localStorage.setItem(READ_STORAGE_KEY, JSON.stringify([...state.read]));
  } catch {
    /* ignorer quota */
  }
}

function loadView() {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    return v === "points" ? "points" : "videos";
  } catch {
    return "videos";
  }
}

function saveView() {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, state.view);
  } catch {
    /* ignorer */
  }
}

function toggleRead(videoId) {
  if (state.read.has(videoId)) state.read.delete(videoId);
  else state.read.add(videoId);
  saveReadSet();
}

function topicCounts(source) {
  const counts = new Map();
  for (const item of source) {
    const list = item.temaer || (item.relevans ? [item.relevans] : []);
    for (const t of list) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return counts;
}

function populateTopics() {
  const counts = topicCounts(state.videos);
  els.topic.innerHTML = '<option value="">Alle tema</option>';
  for (const topic of [...counts.keys()].sort()) {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = `${topicLabel(topic)} (${counts.get(topic)})`;
    els.topic.append(option);
  }
}

function searchScoreVideo(video, terms) {
  if (!terms.length) return 0;
  const topics = (video.temaer || []).map((topic) => `${topic} ${topicLabel(topic)}`).join(" ");
  return scoreFields(
    [
      { text: normalizeSearchText(video.title), weight: 8 },
      { text: normalizeSearchText(topics), weight: 6 },
      { text: normalizeSearchText(video.kort_sammendrag), weight: 4 },
    ],
    terms,
  );
}

function searchScorePoint(point, terms) {
  if (!terms.length) return 0;
  const relevans = point.relevans || "annet";
  return scoreFields(
    [
      { text: normalizeSearchText(point.tittel), weight: 10 },
      { text: normalizeSearchText(`${relevans} ${topicLabel(relevans)}`), weight: 6 },
      { text: normalizeSearchText(point.forklaring), weight: 3 },
      { text: normalizeSearchText(point.praktisk_folelse), weight: 3 },
      { text: normalizeSearchText(point.sitat), weight: 2 },
      { text: normalizeSearchText(point.video_title), weight: 2 },
    ],
    terms,
  );
}

function activeTerms() {
  return normalizeSearchText(els.search.value).split(/\s+/).filter(Boolean);
}

function filteredVideos() {
  const terms = activeTerms();
  const topic = els.topic.value;
  const scored = state.videos.map((video) => ({ video, score: searchScoreVideo(video, terms) }));
  const filtered = scored.filter(({ video, score }) => {
    if (terms.length && score < 0) return false;
    if (topic && !(video.temaer || []).includes(topic)) return false;
    return true;
  });
  if (terms.length) {
    filtered.sort((a, b) => b.score - a.score || String(a.video.title).localeCompare(String(b.video.title), "no"));
  }
  return filtered.map(({ video }) => video);
}

function filteredPoints() {
  if (!state.allPoints) return [];
  const terms = activeTerms();
  const topic = els.topic.value;
  const scored = state.allPoints.map((point) => ({ point, score: searchScorePoint(point, terms) }));
  const filtered = scored.filter(({ point, score }) => {
    if (terms.length && score < 0) return false;
    if (topic && point.relevans !== topic) return false;
    return true;
  });
  if (terms.length) {
    filtered.sort((a, b) => b.score - a.score || String(a.point.tittel).localeCompare(String(b.point.tittel), "no"));
  }
  return filtered.map(({ point }) => point);
}

function hasActiveFilters() {
  return Boolean(els.search.value.trim() || els.topic.value);
}

function updateClearFiltersButton() {
  els.clearFilters.hidden = !hasActiveFilters();
}

function pointsStatusText(visible, total) {
  const warning = state.pointLoadErrors.length
    ? ` · ${state.pointLoadErrors.length} videoer kunne ikke lastes`
    : "";
  return `${visible} av ${total} punkter vises${warning}`;
}

function renderVideoList() {
  const videos = filteredVideos();
  if (!videos.length) {
    els.videoList.innerHTML = '<p class="empty list-empty">Ingen videoer matcher søket.</p>';
    els.status.textContent = `0 av ${state.videos.length} videoer vises`;
    if (hasActiveFilters()) {
      els.details.innerHTML = '<p class="empty">Ingen videoer i trefflisten. Tøm eller endre filteret for å velge en video.</p>';
    }
    return;
  }

  els.videoList.innerHTML = videos
    .map((video) => {
      const active = state.selected?.video_id === video.video_id ? " active" : "";
      const read = state.read.has(video.video_id) ? " is-read" : "";
      const topics = (video.temaer || [])
        .slice(0, 3)
        .map((t) => `<span class="pill" data-topic="${escapeHtml(t)}">${escapeHtml(topicLabel(t))}</span>`)
        .join("");
      return `
        <button class="video-button${active}${read}" data-id="${escapeHtml(video.video_id)}">
          <span class="video-title">${escapeHtml(video.title || video.video_id)}</span>
          <span class="video-meta">
            <span class="pill">${Number(video.antall_punkter || 0)} punkt</span>
            ${topics}
          </span>
        </button>
      `;
    })
    .join("");

  const readCount = videos.filter((v) => state.read.has(v.video_id)).length;
  els.status.textContent = `${videos.length} av ${state.videos.length} videoer · ${readCount} lest`;

  const selectedVisible = state.selected && videos.some((video) => video.video_id === state.selected.video_id);
  if (state.selected && !selectedVisible && hasActiveFilters()) {
    els.details.innerHTML = '<p class="empty">Velg en video fra trefflisten for å se læringspunkter.</p>';
  } else if (state.selected && selectedVisible) {
    renderDetails(state.selected);
  }
}

function renderDetails(video) {
  if (!video) {
    els.details.innerHTML = '<p class="empty">Velg en video for å se læringspunkter.</p>';
    return;
  }
  const topics = (video.temaer || [])
    .map((t) => `<button type="button" class="pill" data-topic="${escapeHtml(t)}">${escapeHtml(topicLabel(t))}</button>`)
    .join("");
  const videoUrl = video.video_lenke || video.url;
  const isRead = state.read.has(video.video_id);
  const related = (video.relaterte_kilder || [])
    .map(
      (source) => `
        <li>
          <a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">
            ${escapeHtml(source.video_id || source.url)}
          </a>
          <p>${escapeHtml(source.hvorfor)}</p>
        </li>
      `,
    )
    .join("");
  const points = (video.laeringspunkter || [])
    .map(
      (point) => `
        <section class="point" id="${escapeHtml(point.punkt_id || "")}">
          <h3>${escapeHtml(point.tittel)}</h3>
          ${point.sitat ? `<p class="point-quote">${escapeHtml(point.sitat)}</p>` : ""}
          <p>${escapeHtml(point.forklaring)}</p>
          ${point.praktisk_folelse ? `<p class="feel"><strong>Følelse:</strong> ${escapeHtml(point.praktisk_folelse)}</p>` : ""}
          <div class="video-meta">
            <button type="button" class="pill" data-topic="${escapeHtml(point.relevans || "annet")}">${escapeHtml(topicLabel(point.relevans || "annet"))}</button>
          </div>
        </section>
      `,
    )
    .join("");

  els.details.innerHTML = `
    <header class="details-header">
      <h2>${escapeHtml(video.title || video.video_id)}</h2>
      <div class="details-actions">
        <button type="button" class="ghost-button" id="toggleRead" aria-pressed="${isRead}">
          ${isRead ? "✓ Lest" : "Marker som lest"}
        </button>
        <a class="open-link" href="${escapeHtml(videoUrl)}" target="_blank" rel="noreferrer">Åpne på YouTube ↗</a>
      </div>
    </header>
    <p class="summary">${escapeHtml(video.kort_sammendrag || "Ingen sammendrag ennå.")}</p>
    <div class="video-meta">${topics}</div>
    ${related ? `
      <section class="related-sources" aria-labelledby="relatedSourcesTitle">
        <h3 id="relatedSourcesTitle">Relaterte kilder</h3>
        <ul>${related}</ul>
      </section>
    ` : ""}
    <div class="points">${points || '<p class="empty">Ingen læringspunkter for denne videoen.</p>'}</div>
  `;

  els.details.querySelector("#toggleRead")?.addEventListener("click", () => {
    toggleRead(video.video_id);
    renderVideoList();
    renderDetails(video);
  });
}

function renderPointsView() {
  if (state.pointsLoading) {
    els.pointsView.innerHTML = '<p class="empty list-empty">Laster læringspunkter ...</p>';
    els.status.textContent = "Laster læringspunkter ...";
    return;
  }
  if (!state.allPoints) {
    els.pointsView.innerHTML = '<p class="empty list-empty">Ingen punkter lastet ennå.</p>';
    return;
  }

  const points = filteredPoints();
  const total = state.allPoints.length;
  if (!points.length) {
    els.pointsView.innerHTML = '<p class="empty list-empty">Ingen læringspunkter matcher filteret.</p>';
    els.status.textContent = pointsStatusText(0, total);
    return;
  }

  els.pointsView.innerHTML = points
    .map(
      (point) => `
        <article class="cross-point" id="${escapeHtml(point.punkt_id || "")}">
          <h3>${escapeHtml(point.tittel)}</h3>
          ${point.sitat ? `<p class="point-quote">${escapeHtml(point.sitat)}</p>` : ""}
          <p>${escapeHtml(point.forklaring)}</p>
          ${point.praktisk_folelse ? `<p class="feel"><strong>Følelse:</strong> ${escapeHtml(point.praktisk_folelse)}</p>` : ""}
          <footer class="cross-point-footer">
            <div class="video-meta">
              <button type="button" class="pill" data-topic="${escapeHtml(point.relevans || "annet")}">${escapeHtml(topicLabel(point.relevans || "annet"))}</button>
            </div>
            <a class="cross-point-source" href="#${encodeURIComponent(point.video_id)}" data-video-id="${escapeHtml(point.video_id)}">
              ${escapeHtml(point.video_title)} ↗
            </a>
          </footer>
        </article>
      `,
    )
    .join("");

  els.status.textContent = pointsStatusText(points.length, total);
}

function rerender() {
  updateClearFiltersButton();
  if (state.view === "points") renderPointsView();
  else renderVideoList();
}

async function selectVideo(videoId, { updateHash = true } = {}) {
  const summary = state.videos.find((v) => v.video_id === videoId);
  if (!summary) return;
  try {
    const full = state.fullVideos.get(videoId) || (await fetchJson(`data/${summary.data_fil}`));
    state.fullVideos.set(videoId, full);
    state.selected = full;
    if (updateHash) {
      const expected = `#${videoId}`;
      if (location.hash !== expected) history.replaceState(null, "", expected);
    }
    renderVideoList();
    renderDetails(full);
    scrollSelectedIntoView();
  } catch (error) {
    console.error("Kunne ikke laste video:", error);
    state.selected = null;
    renderVideoList();
    els.details.innerHTML = `
      <p class="empty">
        Kunne ikke laste videoen «${escapeHtml(summary.title || videoId)}». ${escapeHtml(error.message)}
      </p>
    `;
  }
}

function scrollSelectedIntoView() {
  els.videoList.querySelector(".video-button.active")?.scrollIntoView({ block: "nearest" });
}

function focusVideoButton(direction) {
  const buttons = [...els.videoList.querySelectorAll(".video-button")];
  if (!buttons.length) return;
  const currentIndex = buttons.findIndex((b) => b.classList.contains("active"));
  const focusedIndex = buttons.findIndex((b) => b === document.activeElement);
  const startIndex = focusedIndex >= 0 ? focusedIndex : currentIndex;
  const nextIndex = startIndex < 0
    ? (direction > 0 ? 0 : buttons.length - 1)
    : (startIndex + direction + buttons.length) % buttons.length;
  buttons[nextIndex].focus();
}

function selectByTopic(topic) {
  els.topic.value = topic;
  rerender();
}

function videoIdFromHash() {
  return location.hash.startsWith("#") ? decodeURIComponent(location.hash.slice(1)) : "";
}

async function loadAllPoints() {
  if (state.allPoints || state.pointsLoading) return;
  state.pointsLoading = true;
  renderPointsView();
  const results = await Promise.allSettled(
    state.videos.map(async (video) => {
      const full = state.fullVideos.get(video.video_id) || (await fetchJson(`data/${video.data_fil}`));
      state.fullVideos.set(video.video_id, full);
      return (full.laeringspunkter || []).map((point) => ({
        ...point,
        video_id: full.video_id || video.video_id,
        video_title: full.title || video.title || video.video_id,
      }));
    }),
  );
  const points = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);
  state.pointLoadErrors = results
    .map((result, index) => ({ result, video: state.videos[index] }))
    .filter(({ result }) => result.status === "rejected")
    .map(({ video }) => video?.data_fil || video?.video_id || "ukjent video");
  if (state.pointLoadErrors.length) {
    console.warn("Kunne ikke laste læringspunkter for:", state.pointLoadErrors);
  }
  state.allPoints = points;
  state.pointsLoading = false;
  renderPointsView();
}

async function setView(view) {
  if (view !== "videos" && view !== "points") return;
  if (state.view === view) return;
  state.view = view;
  saveView();
  for (const tab of els.viewTabs) {
    const active = tab.dataset.view === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.setAttribute("tabindex", active ? "0" : "-1");
  }
  els.videosView.hidden = view !== "videos";
  els.pointsView.hidden = view !== "points";
  if (view === "points") {
    await loadAllPoints();
    renderPointsView();
  } else {
    renderVideoList();
  }
  updateClearFiltersButton();
}

function clearFilters() {
  els.search.value = "";
  els.topic.value = "";
  rerender();
}

async function init() {
  try {
    const index = await fetchJson("data/index.json");
    state.videos = index.videoer || [];
    populateTopics();
    for (const tab of els.viewTabs) {
      const active = tab.dataset.view === state.view;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.setAttribute("tabindex", active ? "0" : "-1");
    }
    els.videosView.hidden = state.view !== "videos";
    els.pointsView.hidden = state.view !== "points";
    renderVideoList();
    const initialId = videoIdFromHash();
    const target = (initialId && state.videos.find((v) => v.video_id === initialId)) || state.videos[0];
    if (target) {
      await selectVideo(target.video_id, { updateHash: Boolean(initialId) });
    }
    if (state.view === "points") await loadAllPoints();
    updateClearFiltersButton();
  } catch (error) {
    els.status.textContent = "Kunne ikke laste data. Kjør scripts/analyser_hocknull.py først.";
    els.details.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  }
}

function debounce(fn, ms) {
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

els.videoList.addEventListener("click", (event) => {
  const pill = event.target.closest(".pill[data-topic]");
  if (pill) {
    event.stopPropagation();
    event.preventDefault();
    selectByTopic(pill.dataset.topic);
    return;
  }
  const button = event.target.closest(".video-button");
  if (button) selectVideo(button.dataset.id);
});

els.details.addEventListener("click", (event) => {
  const pill = event.target.closest(".pill[data-topic]");
  if (pill) selectByTopic(pill.dataset.topic);
});

els.pointsView.addEventListener("click", (event) => {
  const pill = event.target.closest(".pill[data-topic]");
  if (pill) {
    event.preventDefault();
    selectByTopic(pill.dataset.topic);
    return;
  }
  const link = event.target.closest("a[data-video-id]");
  if (link) {
    event.preventDefault();
    const id = link.dataset.videoId;
    setView("videos").then(() => selectVideo(id));
  }
});

els.videoList.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusVideoButton(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    focusVideoButton(-1);
  }
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const inField = target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
  if (event.key === "/" && !inField) {
    event.preventDefault();
    els.search.focus();
    els.search.select();
  } else if (event.key === "Escape" && document.activeElement === els.search) {
    els.search.value = "";
    rerender();
    els.search.blur();
  }
});

window.addEventListener("hashchange", () => {
  const id = videoIdFromHash();
  if (id && id !== state.selected?.video_id) {
    if (state.view !== "videos") setView("videos").then(() => selectVideo(id, { updateHash: false }));
    else selectVideo(id, { updateHash: false });
  }
});

for (const tab of els.viewTabs) {
  tab.addEventListener("click", () => setView(tab.dataset.view));
}

els.clearFilters.addEventListener("click", clearFilters);

els.search.addEventListener("input", debounce(rerender, 150));
els.topic.addEventListener("input", rerender);

init();
