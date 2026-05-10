const READ_STORAGE_KEY = "hocknull.read";
const VIEW_STORAGE_KEY = "hocknull.view";
const COLLECTION_STORAGE_KEY = "hocknull.collection";
const NOTE_AUTOSAVE_MS = 400;

const state = {
  videos: [],
  fullVideos: new Map(),
  selected: null,
  read: loadReadSet(),
  view: loadView(),
  allPoints: null,
  pointSearchByVideo: new Map(),
  pointLoadErrors: [],
  pointsLoading: false,
  collection: loadCollection(),
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
  collectionView: document.querySelector("#collectionView"),
  collectionList: document.querySelector("#collectionList"),
  collectionCount: document.querySelector("#collectionCount"),
  collectionExportMd: document.querySelector("#collectionExportMd"),
  collectionExportJson: document.querySelector("#collectionExportJson"),
  collectionImport: document.querySelector("#collectionImport"),
  collectionImportFile: document.querySelector("#collectionImportFile"),
  collectionClear: document.querySelector("#collectionClear"),
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
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function topicSearchText(topics) {
  return (topics || []).map((topic) => `${topic} ${topicLabel(topic)}`).join(" ");
}

function relatedSearchText(sources) {
  return (sources || [])
    .map((source) => `${source.video_id || ""} ${source.url || ""} ${source.hvorfor || ""}`)
    .join(" ");
}

function buildVideoSearchFields(video) {
  return [
    { text: normalizeSearchText(video.title), weight: 8 },
    { text: normalizeSearchText(topicSearchText(video.temaer)), weight: 6 },
    { text: normalizeSearchText(video.kort_sammendrag), weight: 4 },
    { text: normalizeSearchText(relatedSearchText(video.relaterte_kilder)), weight: 2 },
  ];
}

function prepareVideo(video) {
  return {
    ...video,
    _searchFields: buildVideoSearchFields(video),
  };
}

function buildPointSearchFields(point) {
  const relevans = point.relevans || "annet";
  return [
    { text: normalizeSearchText(point.tittel), weight: 10 },
    { text: normalizeSearchText(`${relevans} ${topicLabel(relevans)}`), weight: 6 },
    { text: normalizeSearchText(topicSearchText(point.video_temaer)), weight: 4 },
    { text: normalizeSearchText(point.forklaring), weight: 3 },
    { text: normalizeSearchText(point.praktisk_folelse), weight: 3 },
    { text: normalizeSearchText(point.sitat), weight: 2 },
    { text: normalizeSearchText(point.video_title), weight: 2 },
  ];
}

function preparePoint(point, full, summary) {
  const videoTemaer = full.temaer || summary.temaer || [];
  const prepared = {
    ...point,
    video_id: full.video_id || summary.video_id,
    video_title: full.title || summary.title || summary.video_id,
    video_temaer: videoTemaer,
  };
  return {
    ...prepared,
    _searchFields: buildPointSearchFields(prepared),
  };
}

function videoPointSearchText(full) {
  const pointText = (full.laeringspunkter || [])
    .map((point) => [
      point.tittel,
      point.forklaring,
      point.praktisk_folelse,
      point.sitat,
      point.relevans,
      topicLabel(point.relevans || "annet"),
    ].join(" "))
    .join(" ");
  return normalizeSearchText(pointText);
}

function updateVideoPointSearch(full) {
  const videoId = full.video_id;
  if (videoId) state.pointSearchByVideo.set(videoId, videoPointSearchText(full));
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
    if (v === "points" || v === "collection") return v;
    return "videos";
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

function loadCollection() {
  try {
    const raw = localStorage.getItem(COLLECTION_STORAGE_KEY);
    if (!raw) return { entries: [], notes: {} };
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const notes = parsed?.notes && typeof parsed.notes === "object" ? parsed.notes : {};
    return {
      entries: entries.filter((e) => e && typeof e.point_id === "string" && typeof e.video_id === "string"),
      notes,
    };
  } catch {
    return { entries: [], notes: {} };
  }
}

function saveCollection() {
  try {
    localStorage.setItem(COLLECTION_STORAGE_KEY, JSON.stringify(state.collection));
  } catch {
    /* ignorer quota */
  }
}

function isInCollection(pointId) {
  return state.collection.entries.some((e) => e.point_id === pointId);
}

function addToCollection(point, video) {
  if (!point?.punkt_id) return false;
  if (isInCollection(point.punkt_id)) return false;
  state.collection.entries.push({
    point_id: point.punkt_id,
    video_id: video.video_id,
    added_at: new Date().toISOString(),
  });
  saveCollection();
  return true;
}

function removeFromCollection(pointId) {
  const before = state.collection.entries.length;
  state.collection.entries = state.collection.entries.filter((e) => e.point_id !== pointId);
  saveCollection();
  return state.collection.entries.length !== before;
}

function getNote(pointId) {
  return state.collection.notes[pointId] || "";
}

function setNote(pointId, value) {
  const trimmed = String(value || "");
  if (trimmed) state.collection.notes[pointId] = trimmed;
  else delete state.collection.notes[pointId];
  saveCollection();
}

function updateCollectionCount() {
  const count = state.collection.entries.length;
  els.collectionCount.textContent = String(count);
  els.collectionCount.hidden = count === 0;
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
  return scoreFields(
    [
      ...(video._searchFields || buildVideoSearchFields(video)),
      { text: state.pointSearchByVideo.get(video.video_id) || "", weight: 2 },
    ],
    terms,
  );
}

function searchScorePoint(point, terms) {
  if (!terms.length) return 0;
  return scoreFields(point._searchFields || buildPointSearchFields(point), terms);
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
    if (topic && point.relevans !== topic && !(point.video_temaer || []).includes(topic)) return false;
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

function pointActionsHtml(pointId, options = {}) {
  if (!pointId) return "";
  const inCollection = isInCollection(pointId);
  const expanded = options.noteOpen || inCollection || Boolean(getNote(pointId));
  const noteLabel = expanded ? "Skjul notat" : "Skriv notat";
  return `
    <div class="point-actions" data-point-id="${escapeHtml(pointId)}">
      <button type="button" class="ghost-button collection-toggle" data-action="toggle-collection" aria-pressed="${inCollection}">
        ${inCollection ? "✓ I samling" : "+ Legg i samling"}
      </button>
      <button type="button" class="ghost-button note-toggle" data-action="toggle-note" aria-expanded="${expanded}">
        ${noteLabel}
      </button>
    </div>
    ${expanded ? noteHtml(pointId) : ""}
  `;
}

function noteHtml(pointId) {
  const value = getNote(pointId);
  return `
    <div class="point-note" data-point-id="${escapeHtml(pointId)}">
      <label for="note-${escapeHtml(pointId)}">Eget notat</label>
      <textarea id="note-${escapeHtml(pointId)}" data-action="note-input" placeholder="Skriv din egen kommentar, drill eller påminnelse …">${escapeHtml(value)}</textarea>
      <p class="point-note-status" data-action="note-status" aria-live="polite"></p>
    </div>
  `;
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
        <section class="point" id="${escapeHtml(point.punkt_id || "")}" data-point-id="${escapeHtml(point.punkt_id || "")}">
          <h3>${escapeHtml(point.tittel)}</h3>
          ${point.sitat ? `<p class="point-quote">${escapeHtml(point.sitat)}</p>` : ""}
          <p>${escapeHtml(point.forklaring)}</p>
          ${point.praktisk_folelse ? `<p class="feel"><strong>Følelse:</strong> ${escapeHtml(point.praktisk_folelse)}</p>` : ""}
          <div class="video-meta">
            <button type="button" class="pill" data-topic="${escapeHtml(point.relevans || "annet")}">${escapeHtml(topicLabel(point.relevans || "annet"))}</button>
          </div>
          ${pointActionsHtml(point.punkt_id)}
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
        <article class="cross-point" id="${escapeHtml(point.punkt_id || "")}" data-point-id="${escapeHtml(point.punkt_id || "")}">
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
          ${pointActionsHtml(point.punkt_id)}
        </article>
      `,
    )
    .join("");

  els.status.textContent = pointsStatusText(points.length, total);
}

function findPointForCollection(entry) {
  const full = state.fullVideos.get(entry.video_id);
  if (!full) return null;
  const point = (full.laeringspunkter || []).find((p) => p.punkt_id === entry.point_id);
  if (!point) return null;
  return { point, full };
}

function ensureCollectionVideosLoaded() {
  const ids = [...new Set(state.collection.entries.map((e) => e.video_id))];
  const missing = ids.filter((id) => !state.fullVideos.has(id));
  if (!missing.length) return Promise.resolve();
  return Promise.all(
    missing.map(async (id) => {
      const summary = state.videos.find((v) => v.video_id === id);
      if (!summary) return;
      try {
        const full = await fetchJson(`data/${summary.data_fil}`);
        state.fullVideos.set(id, full);
        updateVideoPointSearch(full);
      } catch (error) {
        console.warn(`Kunne ikke laste ${id} for samling:`, error);
      }
    }),
  );
}

function renderCollectionView() {
  const entries = state.collection.entries;
  if (!entries.length) {
    els.collectionList.innerHTML = `
      <p class="collection-empty">
        Samlingen er tom. Klikk «+ Legg i samling» på et læringspunkt for å bygge din egen instruksjonsbok.
      </p>
    `;
    els.status.textContent = "Samling: 0 punkter";
    return;
  }

  const cards = entries.map((entry) => {
    const found = findPointForCollection(entry);
    if (!found) {
      return `
        <article class="collection-card" data-point-id="${escapeHtml(entry.point_id)}">
          <h3>${escapeHtml(entry.point_id)}</h3>
          <p class="empty">Kunne ikke laste dette punktet (videoen mangler eller er fjernet).</p>
          <footer class="collection-card-footer">
            <button type="button" class="ghost-button danger" data-action="remove-from-collection">Fjern fra samling</button>
          </footer>
        </article>
      `;
    }
    const { point, full } = found;
    const videoUrl = full.video_lenke || full.url || `https://www.youtube.com/watch?v=${full.video_id}`;
    return `
      <article class="collection-card" data-point-id="${escapeHtml(point.punkt_id)}">
        <h3>${escapeHtml(point.tittel)}</h3>
        ${point.sitat ? `<p class="point-quote">${escapeHtml(point.sitat)}</p>` : ""}
        <p>${escapeHtml(point.forklaring)}</p>
        ${point.praktisk_folelse ? `<p class="feel"><strong>Følelse:</strong> ${escapeHtml(point.praktisk_folelse)}</p>` : ""}
        <div class="video-meta">
          <button type="button" class="pill" data-topic="${escapeHtml(point.relevans || "annet")}">${escapeHtml(topicLabel(point.relevans || "annet"))}</button>
        </div>
        ${noteHtml(point.punkt_id)}
        <footer class="collection-card-footer">
          <a class="collection-card-source" href="${escapeHtml(videoUrl)}" target="_blank" rel="noreferrer">
            ${escapeHtml(full.title || full.video_id)} ↗
          </a>
          <button type="button" class="ghost-button danger" data-action="remove-from-collection">Fjern</button>
        </footer>
      </article>
    `;
  });

  els.collectionList.innerHTML = cards.join("");
  els.status.textContent = `Samling: ${entries.length} punkter`;
}

function rerender() {
  updateClearFiltersButton();
  if (state.view === "points") renderPointsView();
  else if (state.view === "collection") renderCollectionView();
  else renderVideoList();
}

function refreshPointDecorations(pointId) {
  if (!pointId) return;
  const containers = document.querySelectorAll(`[data-point-id="${CSS.escape(pointId)}"] .point-actions`);
  containers.forEach((container) => {
    const toggle = container.querySelector('[data-action="toggle-collection"]');
    if (!toggle) return;
    const inCollection = isInCollection(pointId);
    toggle.setAttribute("aria-pressed", String(inCollection));
    toggle.textContent = inCollection ? "✓ I samling" : "+ Legg i samling";
  });
  updateCollectionCount();
}

async function selectVideo(videoId, { updateHash = true } = {}) {
  const summary = state.videos.find((v) => v.video_id === videoId);
  if (!summary) return;
  try {
    const full = state.fullVideos.get(videoId) || (await fetchJson(`data/${summary.data_fil}`));
    state.fullVideos.set(videoId, full);
    updateVideoPointSearch(full);
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

async function loadAllPoints({ silent = false } = {}) {
  if (state.allPoints || state.pointsLoading) return;
  state.pointsLoading = true;
  if (!silent) renderPointsView();
  const results = await Promise.allSettled(
    state.videos.map(async (video) => {
      const full = state.fullVideos.get(video.video_id) || (await fetchJson(`data/${video.data_fil}`));
      state.fullVideos.set(video.video_id, full);
      updateVideoPointSearch(full);
      return (full.laeringspunkter || []).map((point) => preparePoint(point, full, video));
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
  if (silent) {
    if (state.view === "points") renderPointsView();
    else if (hasActiveFilters()) renderVideoList();
  } else {
    renderPointsView();
  }
}

function schedulePointPreload() {
  const preload = () => loadAllPoints({ silent: true }).catch((error) => {
    console.warn("Kunne ikke forhåndslaste læringspunkter:", error);
    state.pointsLoading = false;
  });
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(preload, { timeout: 2500 });
  } else {
    window.setTimeout(preload, 800);
  }
}

async function setView(view) {
  if (view !== "videos" && view !== "points" && view !== "collection") return;
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
  els.collectionView.hidden = view !== "collection";
  if (view === "points") {
    await loadAllPoints();
    renderPointsView();
  } else if (view === "collection") {
    await ensureCollectionVideosLoaded();
    renderCollectionView();
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
    state.videos = (index.videoer || []).map(prepareVideo);
    populateTopics();
    for (const tab of els.viewTabs) {
      const active = tab.dataset.view === state.view;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.setAttribute("tabindex", active ? "0" : "-1");
    }
    els.videosView.hidden = state.view !== "videos";
    els.pointsView.hidden = state.view !== "points";
    els.collectionView.hidden = state.view !== "collection";
    updateCollectionCount();
    renderVideoList();
    const initialId = videoIdFromHash();
    const target = (initialId && state.videos.find((v) => v.video_id === initialId)) || state.videos[0];
    if (target) {
      await selectVideo(target.video_id, { updateHash: Boolean(initialId) });
    }
    if (state.view === "points") await loadAllPoints();
    else if (state.view === "collection") {
      await ensureCollectionVideosLoaded();
      renderCollectionView();
      schedulePointPreload();
    } else schedulePointPreload();
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

const noteSaveTimers = new Map();

function scheduleNoteSave(pointId, value, statusEl) {
  if (!pointId) return;
  if (noteSaveTimers.has(pointId)) clearTimeout(noteSaveTimers.get(pointId));
  if (statusEl) statusEl.textContent = "Lagrer …";
  const timer = setTimeout(() => {
    setNote(pointId, value);
    if (statusEl) {
      statusEl.textContent = "Lagret lokalt";
      setTimeout(() => {
        if (statusEl.textContent === "Lagret lokalt") statusEl.textContent = "";
      }, 1200);
    }
    noteSaveTimers.delete(pointId);
  }, NOTE_AUTOSAVE_MS);
  noteSaveTimers.set(pointId, timer);
}

function findPointActionsContainer(target) {
  return target.closest(".point-actions");
}

function handlePointActionClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return false;
  const container = findPointActionsContainer(button);
  if (!container) return false;
  const pointId = container.dataset.pointId;
  if (!pointId) return false;
  const action = button.dataset.action;
  if (action === "toggle-collection") {
    if (isInCollection(pointId)) {
      removeFromCollection(pointId);
    } else {
      const found = findPointInState(pointId);
      if (!found) return true;
      addToCollection(found.point, found.video);
    }
    refreshPointDecorations(pointId);
    if (state.view === "collection") renderCollectionView();
    return true;
  }
  if (action === "toggle-note") {
    const noteEl = container.parentElement?.querySelector(`.point-note[data-point-id="${CSS.escape(pointId)}"]`);
    if (noteEl) {
      noteEl.remove();
      button.setAttribute("aria-expanded", "false");
      button.textContent = "Skriv notat";
    } else {
      container.insertAdjacentHTML("afterend", noteHtml(pointId));
      button.setAttribute("aria-expanded", "true");
      button.textContent = "Skjul notat";
      const newTextarea = container.parentElement?.querySelector(`.point-note[data-point-id="${CSS.escape(pointId)}"] textarea`);
      newTextarea?.focus();
    }
    return true;
  }
  return false;
}

function findPointInState(pointId) {
  for (const full of state.fullVideos.values()) {
    const point = (full.laeringspunkter || []).find((p) => p.punkt_id === pointId);
    if (point) return { point, video: full };
  }
  if (state.allPoints) {
    const point = state.allPoints.find((p) => p.punkt_id === pointId);
    if (point) {
      const video = state.fullVideos.get(point.video_id) || { video_id: point.video_id, title: point.video_title };
      return { point, video };
    }
  }
  return null;
}

function handleNoteInput(event) {
  const textarea = event.target.closest('textarea[data-action="note-input"]');
  if (!textarea) return;
  const wrapper = textarea.closest(".point-note");
  if (!wrapper) return;
  const pointId = wrapper.dataset.pointId;
  const statusEl = wrapper.querySelector('[data-action="note-status"]');
  scheduleNoteSave(pointId, textarea.value, statusEl);
}

function handleRemoveFromCollection(event) {
  const button = event.target.closest('button[data-action="remove-from-collection"]');
  if (!button) return false;
  const card = button.closest(".collection-card");
  const pointId = card?.dataset.pointId;
  if (!pointId) return false;
  removeFromCollection(pointId);
  refreshPointDecorations(pointId);
  renderCollectionView();
  return true;
}

function buildMarkdown() {
  const entries = state.collection.entries;
  if (!entries.length) return "# Min instruksjonsbok\n\n_Ingen punkter lagt til ennå._\n";
  const lines = ["# Min instruksjonsbok", "", `_Eksportert ${new Date().toISOString().slice(0, 10)} fra Hocknull-appen._`, ""];
  entries.forEach((entry, index) => {
    const found = findPointForCollection(entry);
    if (!found) {
      lines.push(`## ${index + 1}. ${entry.point_id}`, "", "_Punktet kunne ikke lastes fra videoen._", "");
      return;
    }
    const { point, full } = found;
    const url = full.video_lenke || full.url || `https://www.youtube.com/watch?v=${full.video_id}`;
    lines.push(`## ${index + 1}. ${point.tittel}`, "");
    lines.push(`*Fra:* [${full.title || full.video_id}](${url})`, "");
    if (point.sitat) lines.push(`> ${point.sitat}`, "");
    if (point.forklaring) lines.push(point.forklaring, "");
    if (point.praktisk_folelse) lines.push(`**Følelse:** ${point.praktisk_folelse}`, "");
    if (point.relevans) lines.push(`*Tema:* ${topicLabel(point.relevans)}`, "");
    const note = getNote(point.punkt_id);
    if (note) lines.push("**Eget notat:**", "", note, "");
    lines.push("---", "");
  });
  return lines.join("\n");
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportMarkdown() {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadFile(`hocknull-instruksjonsbok-${stamp}.md`, buildMarkdown(), "text/markdown;charset=utf-8");
}

function exportJson() {
  const stamp = new Date().toISOString().slice(0, 10);
  const payload = JSON.stringify(state.collection, null, 2);
  downloadFile(`hocknull-samling-${stamp}.json`, payload, "application/json");
}

async function importJsonFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const notes = parsed?.notes && typeof parsed.notes === "object" ? parsed.notes : {};
    const existingIds = new Set(state.collection.entries.map((e) => e.point_id));
    let added = 0;
    for (const entry of entries) {
      if (!entry?.point_id || !entry?.video_id) continue;
      if (existingIds.has(entry.point_id)) continue;
      state.collection.entries.push({
        point_id: entry.point_id,
        video_id: entry.video_id,
        added_at: entry.added_at || new Date().toISOString(),
      });
      existingIds.add(entry.point_id);
      added += 1;
    }
    let noteCount = 0;
    for (const [pointId, value] of Object.entries(notes)) {
      if (typeof value === "string" && value.trim()) {
        state.collection.notes[pointId] = value;
        noteCount += 1;
      }
    }
    saveCollection();
    updateCollectionCount();
    if (state.view === "collection") {
      await ensureCollectionVideosLoaded();
      renderCollectionView();
    }
    alert(`Importert ${added} nye punkter og ${noteCount} notater.`);
  } catch (error) {
    console.error(error);
    alert("Kunne ikke importere fil. Sjekk at det er en gyldig JSON-eksport.");
  }
}

function clearCollection() {
  if (!state.collection.entries.length && !Object.keys(state.collection.notes).length) return;
  const confirmed = window.confirm(
    `Tøm hele samlingen og slett ${state.collection.entries.length} punkter og notater? Dette kan ikke angres (eksporter først om du vil ta vare på det).`,
  );
  if (!confirmed) return;
  const affectedIds = state.collection.entries.map((e) => e.point_id);
  state.collection = { entries: [], notes: {} };
  saveCollection();
  updateCollectionCount();
  affectedIds.forEach(refreshPointDecorations);
  if (state.view === "collection") renderCollectionView();
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
  if (handlePointActionClick(event)) return;
  const pill = event.target.closest(".pill[data-topic]");
  if (pill) selectByTopic(pill.dataset.topic);
});

els.details.addEventListener("input", handleNoteInput);

els.pointsView.addEventListener("click", (event) => {
  if (handlePointActionClick(event)) return;
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

els.pointsView.addEventListener("input", handleNoteInput);

els.collectionView.addEventListener("click", (event) => {
  if (handleRemoveFromCollection(event)) return;
  const pill = event.target.closest(".pill[data-topic]");
  if (pill) {
    event.preventDefault();
    setView("points").then(() => selectByTopic(pill.dataset.topic));
  }
});

els.collectionView.addEventListener("input", handleNoteInput);

els.collectionExportMd.addEventListener("click", exportMarkdown);
els.collectionExportJson.addEventListener("click", exportJson);
els.collectionClear.addEventListener("click", clearCollection);
els.collectionImport.addEventListener("click", () => els.collectionImportFile.click());
els.collectionImportFile.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  importJsonFile(file).finally(() => {
    event.target.value = "";
  });
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
