/* ==========================================================================
   LUMINOVA V2 — APPLICATION LOGIC
   ========================================================================== */

const defaultHost =
  window.location.hostname && window.location.hostname !== "file:" && window.location.hostname !== ""
    ? window.location.hostname : "127.0.0.1";
const API_BASE =
  localStorage.getItem("blogs_api_base") ||
  (window.location.hostname === "localhost" ||
   window.location.hostname === "127.0.0.1"
    ? `http://${defaultHost}:8000`
    : "/api");
const TOKEN_KEY = "blogs_access_token";

const state = {
  token: localStorage.getItem(TOKEN_KEY),
  user: null,
  blogs: [],
  currentBlog: null,
  page: 1,
  limit: 9,
  total: 0,
  sort: "newest",
  search: "",
  editingBlog: null,
  pendingAvatarDataUrl: null,
  pendingFiles: [],   // [{ id, file, preview }] queued for upload on publish
};

let revealObserver = null;

/* ═══════════════════════════════════════════════
   CACHE — stale-while-revalidate
   Renders cached data instantly when navigating back to a page,
   then quietly refreshes in the background.
═══════════════════════════════════════════════ */

const CACHE_TTL = 60 * 1000; // treat entries as fresh for 60s
const cache = new Map();     // key -> { data, at }

const cacheGet = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  return { data: hit.data, stale: Date.now() - hit.at > CACHE_TTL };
};

const cacheSet = (key, data) => cache.set(key, { data, at: Date.now() });

/* Drop cache entries whose key contains any of the given fragments */
function cacheInvalidate(...fragments) {
  if (!fragments.length) { cache.clear(); return; }
  for (const key of Array.from(cache.keys())) {
    if (fragments.some((f) => key.includes(f))) cache.delete(key);
  }
}

const feedCacheKey = () =>
  `feed:${state.page}:${state.limit}:${state.sort}:${state.search}`;

/* Fetch through the cache.
   onData may be called twice: once with cached data, once with fresh. */
async function cachedFetch(key, fetcher, onData) {
  const hit = cacheGet(key);
  if (hit) {
    onData(hit.data, { fromCache: true });
    if (!hit.stale) return hit.data;   // fresh enough, no network call
    try {
      const fresh = await fetcher();   // stale: revalidate quietly
      cacheSet(key, fresh);
      onData(fresh, { fromCache: false, revalidated: true });
      return fresh;
    } catch {
      return hit.data;                 // keep showing cached data on failure
    }
  }
  const data = await fetcher();
  cacheSet(key, data);
  onData(data, { fromCache: false });
  return data;
}

/* ═══════════════════════════════════════════════
   SKELETONS
═══════════════════════════════════════════════ */

const SKELETON_WIDTHS = [
  ["w90", "w70"], ["w80", "w60"], ["w70", "w90"],
  ["w90", "w60"], ["w60", "w80"], ["w80", "w70"],
];

function skeletonCard(i) {
  const [a, b] = SKELETON_WIDTHS[i % SKELETON_WIDTHS.length];
  return `
    <article class="blog-card skeleton-card" aria-hidden="true">
      <div class="skeleton-thumb"></div>
      <div class="skeleton-body">
        <div class="skeleton-line title ${a}"></div>
        <div class="skeleton-line w100"></div>
        <div class="skeleton-line ${b}"></div>
        <div class="skeleton-meta">
          <div class="skeleton-circle"></div>
          <div class="skeleton-line w40" style="margin-bottom:0;"></div>
        </div>
      </div>
    </article>`;
}

/* Fill a grid with placeholder cards that match the real card layout */
function showSkeletons(root, count = 6) {
  if (!root) return;
  root.setAttribute("aria-busy", "true");
  root.innerHTML = Array.from({ length: count }, (_, i) => skeletonCard(i)).join("");
}

function clearBusy(root) {
  root?.removeAttribute("aria-busy");
}

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const pages = {
  feed: null, blog: null, login: null, signup: null,
  create: null, edit: null, profile: null, starred: null,
};

/* ═══════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {
  pages.feed    = $("#page-feed");
  pages.blog    = $("#page-blog");
  pages.login   = $("#page-login");
  pages.signup  = $("#page-signup");
  pages.create  = $("#page-create");
  pages.edit    = $("#page-edit");
  pages.profile = $("#page-profile");
  pages.starred = $("#page-starred");

  bindGlobalEvents();
  hydrateAuth();
  route();
  initNavbarScroll();
});

window.addEventListener("hashchange", route);

function initNavbarScroll() {
  const nav = $("#main-navbar");
  if (!nav) return;
  const h = () => nav.classList.toggle("scrolled", window.scrollY > 12);
  window.addEventListener("scroll", h, { passive: true });
  h();
}

/* ═══════════════════════════════════════════════
   EVENTS
═══════════════════════════════════════════════ */

function bindGlobalEvents() {
  // hamburger
  const hamburger  = $("#hamburger");
  const mobileMenu = $("#mobile-menu");
  hamburger?.addEventListener("click", () => {
    const open = mobileMenu.classList.toggle("open");
    hamburger.setAttribute("aria-expanded", String(open));
  });

  // user dropdown
  const avatarBtn = $("#user-avatar-btn");
  const dropdown  = $("#user-dropdown");
  avatarBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = dropdown.classList.toggle("open");
    avatarBtn.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", () => dropdown?.classList.remove("open"));

  // auth
  $("#logout-btn")?.addEventListener("click", logout);
  $("#mobile-logout-btn")?.addEventListener("click", logout);

  // forms
  $("#login-form")?.addEventListener("submit", onLogin);
  $("#signup-form")?.addEventListener("submit", onSignup);
  $("#create-form")?.addEventListener("submit", onCreateBlog);
  $("#edit-form")?.addEventListener("submit", onUpdateBlog);
  $("#profile-edit-form")?.addEventListener("submit", onSaveProfile);
  $("#edit-profile-toggle")?.addEventListener("click", showProfileEditor);
  $("#cancel-edit-profile")?.addEventListener("click", () => {
    const el = $("#profile-edit");
    if (el) el.style.display = "none";
  });

  // title char counter + preview
  $("#create-title")?.addEventListener("input", () => {
    const len = $("#create-title").value.length;
    const el  = $("#create-title-count");
    if (el) {
      el.textContent = len;
      el.style.color = len > 180 ? "var(--rose)" : len > 140 ? "var(--amber)" : "var(--text-dim)";
    }
    updateCreatePreview();
  });
  $("#create-content")?.addEventListener("input", updateCreatePreview);

  // visibility toggles
  $("#create-visibility")?.addEventListener("change", (e) => {
    const vis  = $("#visibility-value");
    const hint = vis ? vis.nextElementSibling : null;
    if (vis)  vis.textContent  = e.target.checked ? "Public"  : "Private";
    if (hint) hint.textContent = e.target.checked ? "— visible to everyone" : "— only you can see this";
  });
  $("#edit-visibility")?.addEventListener("change", (e) => {
    const vis = $("#edit-visibility-value");
    if (vis) vis.textContent = e.target.checked ? "Public" : "Private";
  });

  bindCoverDropZone();
  bindEditImageZone();
  bindAvatarDrop();
  bindProfileAvatarUploader();

  // search
  $("#global-search")?.addEventListener("input", debounce((e) => {
    state.search = e.target.value.trim();
    state.page   = 1;
    loadFeed();
  }, 320));

  // keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      e.preventDefault();
      $("#global-search")?.focus();
    }
    if (e.key === "Escape") {
      closeLightbox();
      $("#confirm-modal")?.classList.remove("active");
    }
  });

  // sort
  $$("#sort-toggle .sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.sort = btn.dataset.sort;
      $$("#sort-toggle .sort-btn").forEach((b) => b.classList.toggle("active", b === btn));
      state.page = 1;
      loadFeed();
    });
  });

  // profile tabs
  $$(".profile-tabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setProfileTab(btn.dataset.tab));
  });

  // lightbox
  $("#lightbox-close")?.addEventListener("click", closeLightbox);
  $("#lightbox-modal")?.addEventListener("click", (e) => {
    if (e.target === $("#lightbox-modal")) closeLightbox();
  });
}

/* ── Multi-image drop zone (create page) ─────── */

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // backend/Supabase practical limit

function bindCoverDropZone() {
  const zone      = $("#cover-drop-zone");
  const fileInput = $("#cover-file-input");
  const browseBtn = $("#cover-browse-btn");
  const clearBtn  = $("#clear-cover-btn");

  const openPicker = () => fileInput?.click();

  if (zone) {
    zone.addEventListener("click",   openPicker);
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
    });
    zone.addEventListener("dragover", (e) => {
      e.preventDefault(); zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove("drag-over");
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      addPendingFiles(e.dataTransfer?.files);
    });
  }

  browseBtn?.addEventListener("click", (e) => { e.stopPropagation(); openPicker(); });
  browseBtn?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); openPicker(); }
  });

  fileInput?.addEventListener("change", (e) => {
    addPendingFiles(e.target.files);
    e.target.value = "";
  });

  clearBtn?.addEventListener("click", () => {
    state.pendingFiles.forEach((p) => URL.revokeObjectURL(p.preview));
    state.pendingFiles = [];
    renderPendingImages();
  });
}

/* Accept many files at once, skipping non-images and oversized files */
function addPendingFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  let skipped = 0;
  files.forEach((file) => {
    if (!file.type.startsWith("image/")) { skipped++; return; }
    if (file.size > MAX_IMAGE_BYTES)     { skipped++; return; }
    state.pendingFiles.push({
      id: `p${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file,
      preview: URL.createObjectURL(file), // object URL: no base64 cost
    });
  });

  if (skipped) toast(`${skipped} file(s) skipped — must be an image under 10 MB.`, "error");
  const added = files.length - skipped;
  if (added > 0) toast(`${added} image${added > 1 ? "s" : ""} added.`, "success");

  renderPendingImages();
}

function renderPendingImages() {
  const grid     = $("#image-preview-grid");
  const ph       = $("#cover-drop-placeholder");
  const clearBtn = $("#clear-cover-btn");
  const pill     = $("#images-count-pill");
  const countEl  = $("#images-count");
  if (!grid) return;

  grid.innerHTML = state.pendingFiles.map((p, i) => `
    <div class="image-preview-item" draggable="true" data-pid="${p.id}" data-index="${i}">
      <img src="${p.preview}" alt="Selected image ${i + 1}" />
      ${i === 0 ? `<span class="cover-flag">Cover</span>` : ""}
      <button type="button" class="image-remove-btn" data-remove="${p.id}" aria-label="Remove image ${i + 1}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`).join("");

  const n = state.pendingFiles.length;
  if (clearBtn) clearBtn.style.display = n ? "" : "none";
  if (pill)     pill.style.display     = n ? "" : "none";
  if (countEl)  countEl.textContent    = n;
  if (ph) {
    const label = ph.querySelector("p");
    if (label) label.textContent = n ? "Drop more images here" : "Drag & drop images here";
  }

  $$("[data-remove]", grid).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id  = btn.dataset.remove;
      const idx = state.pendingFiles.findIndex((p) => p.id === id);
      if (idx > -1) {
        URL.revokeObjectURL(state.pendingFiles[idx].preview);
        state.pendingFiles.splice(idx, 1);
        renderPendingImages();
      }
    });
  });

  enableReorder(grid);
  updateCreatePreview();
}

/* Drag-to-reorder previews; index 0 is the cover */
function enableReorder(grid) {
  let dragId = null;

  $$(".image-preview-item", grid).forEach((item) => {
    item.addEventListener("dragstart", (e) => {
      dragId = item.dataset.pid;
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", dragId); } catch {}
    });
    item.addEventListener("dragend", () => {
      dragId = null;
      item.classList.remove("dragging");
      $$(".image-preview-item", grid).forEach((n) => n.classList.remove("drop-target"));
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (dragId && item.dataset.pid !== dragId) item.classList.add("drop-target");
    });
    item.addEventListener("dragleave", () => item.classList.remove("drop-target"));
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove("drop-target");
      const from = state.pendingFiles.findIndex((p) => p.id === dragId);
      const to   = state.pendingFiles.findIndex((p) => p.id === item.dataset.pid);
      if (from > -1 && to > -1 && from !== to) {
        const [moved] = state.pendingFiles.splice(from, 1);
        state.pendingFiles.splice(to, 0, moved);
        renderPendingImages();
      }
    });
  });
}

/* Upload selected files to the multipart endpoint.
   Field name must be "images" to match: images: list[UploadFile] = File(...) */
function uploadImagesForBlog(blogId, files, ui) {
  return new Promise((resolve, reject) => {
    if (!files.length) return resolve([]);

    const form = new FormData();
    files.forEach((f) => form.append("images", f, f.name));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/blogs/${blogId}/images/upload`);
    if (state.token) xhr.setRequestHeader("Authorization", `Bearer ${state.token}`);

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || !ui) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      if (ui.bar) ui.bar.style.width = `${pct}%`;
      if (ui.pct) ui.pct.textContent = `${pct}%`;
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { resolve([]); }
      } else {
        let msg = `Image upload failed (${xhr.status})`;
        try {
          const d = JSON.parse(xhr.responseText).detail;
          if (d) msg = Array.isArray(d) ? d.map((x) => x.msg).join(", ") : d;
        } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during image upload."));
    xhr.send(form);
  });
}

/* ── Edit-page image manager ─────────────────── */

function bindEditImageZone() {
  const zone      = $("#edit-drop-zone");
  const fileInput = $("#edit-file-input");
  const browseBtn = $("#edit-browse-btn");
  const openPicker = () => fileInput?.click();

  if (zone) {
    zone.addEventListener("click",   openPicker);
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
    });
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave",(e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove("drag-over"); });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      uploadToExistingBlog(e.dataTransfer?.files);
    });
  }
  browseBtn?.addEventListener("click", (e) => { e.stopPropagation(); openPicker(); });
  fileInput?.addEventListener("change", (e) => {
    uploadToExistingBlog(e.target.files);
    e.target.value = "";
  });
}

async function uploadToExistingBlog(fileList) {
  if (!state.editingBlog) return;
  const files = Array.from(fileList || []).filter(
    (f) => f.type.startsWith("image/") && f.size <= MAX_IMAGE_BYTES
  );
  if (!files.length) { toast("No valid images (max 10 MB each).", "error"); return; }

  const wrap = $("#edit-upload-progress");
  const bar  = $("#edit-upload-progress-bar");
  const pct  = $("#edit-upload-progress-pct");
  if (wrap) wrap.style.display = "";
  if (bar)  bar.style.width = "0%";

  try {
    await uploadImagesForBlog(state.editingBlog.id, files, { bar, pct });
    toast(`${files.length} image${files.length > 1 ? "s" : ""} uploaded.`, "success");
    const fresh = await api(`/blogs/${state.editingBlog.id}`);
    state.editingBlog = fresh;
    cacheSet(`blog:${fresh.id}`, fresh);
    cacheInvalidate("feed:", "me:blogs", "me:starred");
    renderEditImages(fresh.images || []);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    if (wrap) setTimeout(() => { wrap.style.display = "none"; }, 500);
  }
}

function renderEditImages(images) {
  const grid    = $("#edit-image-grid");
  const pill    = $("#edit-images-count-pill");
  const countEl = $("#edit-images-count");
  if (!grid) return;

  const sorted = sortImages(images);
  grid.innerHTML = sorted.map((img, i) => `
    <div class="image-preview-item" data-img-id="${img.id}">
      <img src="${escAttr(fixImageUrl(img.image_url))}" alt="Image ${i + 1}" loading="lazy" />
      ${i === 0 ? `<span class="cover-flag">Cover</span>` : ""}
      <button type="button" class="image-remove-btn" data-del-img="${img.id}" aria-label="Delete image ${i + 1}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`).join("");

  if (pill)    pill.style.display  = sorted.length ? "" : "none";
  if (countEl) countEl.textContent = sorted.length;

  $$("[data-del-img]", grid).forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id  = Number(btn.dataset.delImg);
      const item = btn.closest(".image-preview-item");
      if (item) item.classList.add("uploading");
      try {
        await api(`/images/${id}`, { method: "DELETE" });
        toast("Image deleted.", "success");
        const fresh = await api(`/blogs/${state.editingBlog.id}`);
        state.editingBlog = fresh;
        cacheSet(`blog:${fresh.id}`, fresh);
        cacheInvalidate("feed:", "me:blogs", "me:starred");
        renderEditImages(fresh.images || []);
      } catch (err) {
        toast(err.message, "error");
        if (item) item.classList.remove("uploading");
      }
    });
  });
}

/* ── Avatar drop zone ────────────────────────── */
function bindAvatarDrop() {
  const wrapper   = $("#profile-avatar-drop");
  const fileInput = $("#avatar-file-input");

  if (wrapper) {
    wrapper.addEventListener("click",    () => fileInput?.click());
    wrapper.addEventListener("keydown",  (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput?.click(); } });
    wrapper.addEventListener("dragover", (e) => { e.preventDefault(); wrapper.classList.add("drag-over-avatar"); });
    wrapper.addEventListener("dragleave",(e) => { if (!wrapper.contains(e.relatedTarget)) wrapper.classList.remove("drag-over-avatar"); });
    wrapper.addEventListener("drop",     (e) => {
      e.preventDefault();
      wrapper.classList.remove("drag-over-avatar");
      const f = e.dataTransfer?.files?.[0];
      if (f) applyAvatarFile(f);
    });
  }
  fileInput?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) applyAvatarFile(f);
    e.target.value = "";
  });
}

/* There is no file-upload endpoint for avatars — PATCH /users/me takes
   profile_image as a string. So downscale to a small square and encode as a
   compact JPEG data URL instead of shipping a multi-MB original. */
function compressAvatar(file, size = 256, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        // center-crop to a square before scaling so faces aren't stretched
        const side = Math.min(img.width, img.height);
        const sx   = (img.width  - side) / 2;
        const sy   = (img.height - side) / 2;

        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

        // PNG/GIF may carry transparency; flatten onto white for JPEG
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (err) { reject(err); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image.")); };
    img.src = url;
  });
}

async function applyAvatarFile(file) {
  if (!file.type.startsWith("image/")) {
    toast("Please choose an image file.", "error");
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    toast("That image is over 10 MB — pick a smaller one.", "error");
    return;
  }
  try {
    const dataUrl = await compressAvatar(file);
    state.pendingAvatarDataUrl = dataUrl;
    setAvatarPreviews(dataUrl);
    const actions = $("#avatar-edit-actions");
    if (actions) actions.style.display = "";
    toast("Photo ready — hit Save Changes to apply.", "success");
  } catch (err) {
    toast(err.message || "Could not process that image.", "error");
  }
}

/* Reflect a new avatar everywhere it appears */
function setAvatarPreviews(src) {
  const targets = ["#profile-avatar", "#nav-avatar", "#avatar-edit-preview"];
  targets.forEach((sel) => {
    const el = $(sel);
    if (el) el.src = src;
  });
  const wrap = $(".avatar-upload-preview");
  if (wrap) {
    wrap.classList.remove("updated");
    void wrap.offsetWidth; // restart the pop animation
    wrap.classList.add("updated");
  }
}

/* ── Avatar uploader inside the edit-profile panel ─────────── */
function bindProfileAvatarUploader() {
  const zone      = $("#avatar-edit-dropzone");
  const fileInput = $("#avatar-edit-input");
  const browseBtn = $("#avatar-edit-browse");
  const resetBtn  = $("#avatar-edit-reset");
  const openPicker = () => fileInput?.click();

  if (zone) {
    zone.addEventListener("click", openPicker);
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
    });
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave", (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove("drag-over");
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const f = e.dataTransfer?.files?.[0];
      if (f) applyAvatarFile(f);
    });
  }

  browseBtn?.addEventListener("click", (e) => { e.stopPropagation(); openPicker(); });
  browseBtn?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); openPicker(); }
  });

  fileInput?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) applyAvatarFile(f);
    e.target.value = "";
  });

  // discard the staged photo and restore the saved one
  resetBtn?.addEventListener("click", () => {
    state.pendingAvatarDataUrl = null;
    setAvatarPreviews(avatarFor(state.user || {}));
    const actions = $("#avatar-edit-actions");
    if (actions) actions.style.display = "none";
    toast("Photo change discarded.", "");
  });
}

/* ═══════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════ */

async function hydrateAuth() {
  document.body.classList.toggle("is-authenticated", Boolean(state.token));
  if (!state.token) return;

  const jwt = parseJwt(state.token);
  const id  = jwt?.user_id;
  if (!id) { logout(false); return; }

  // Baseline from the token so the UI can paint before the request lands
  state.user = {
    id,
    email: jwt?.user_email,
    username: jwt?.user_email?.split("@")[0] || "Writer",
  };
  renderAuth();

  try {
    // GET /users/{id} -> PublicUser: username, profile_image, bio, created_at.
    // This is what makes a saved avatar survive a page reload.
    const profile = await cachedFetch(`user:${id}`, () => api(`/users/${id}`), () => {});
    state.user = { ...state.user, ...profile, email: state.user.email || profile.email };
    renderAuth();
    if (pages.profile?.classList.contains("active")) renderProfileHeader();
  } catch (err) {
    // A 401 means the token is dead; anything else is non-fatal.
    if (/401|invalid token/i.test(err.message)) logout(false);
  }
}

function renderAuth() {
  document.body.classList.toggle("is-authenticated", Boolean(state.token));
  const user = state.user || {};
  const name = user.username || user.email?.split("@")[0] || "Writer";
  const nn = $("#nav-username"); if (nn) nn.textContent = name;
  const na = $("#nav-avatar");   if (na) { na.src = state.pendingAvatarDataUrl || avatarFor(user); na.alt = name; }
}

async function onLogin(e) {
  e.preventDefault();
  const errEl = $("#login-error");
  if (errEl) errEl.textContent = "";
  const btn = $("#login-form .btn-primary");
  setLoading(btn, true);
  try {
    const data = await api("/login", {
      method: "POST",
      body: JSON.stringify({ email: $("#login-email")?.value.trim(), password: $("#login-password")?.value }),
    });
    state.token = data.token;
    localStorage.setItem(TOKEN_KEY, state.token);
    // guest-view lists omit is_starred, so discard them on sign-in
    cache.clear();
    await hydrateAuth();
    toast("Welcome back!", "success");
    window.location.hash = "#/";
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  } finally { setLoading(btn, false); }
}

async function onSignup(e) {
  e.preventDefault();
  const errEl = $("#signup-error");
  if (errEl) errEl.textContent = "";
  const btn = $("#signup-form .btn-primary");
  setLoading(btn, true);
  try {
    await api("/signup", {
      method: "POST",
      body: JSON.stringify({ email: $("#signup-email")?.value.trim(), password: $("#signup-password")?.value }),
    });
    toast("Account created — you can sign in now.", "success");
    window.location.hash = "#/login";
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  } finally { setLoading(btn, false); }
}

function logout(announce = true) {
  state.token = null;
  state.user  = null;
  state.pendingAvatarDataUrl = null;
  cache.clear(); // never leak one account's cached data to the next
  localStorage.removeItem(TOKEN_KEY);
  renderAuth();
  if (announce) toast("Logged out.", "success");
  if (!["#/", ""].includes(window.location.hash)) window.location.hash = "#/";
}

/* ═══════════════════════════════════════════════
   API
═══════════════════════════════════════════════ */

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined && !(options.body instanceof FormData) && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
  const res  = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const ct   = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const d = typeof data === "object" ? (data.detail || data.message) : data;
    throw new Error(Array.isArray(d) ? d.map((x) => x.msg).join(", ") : d || "Request failed");
  }
  return data;
}

/* ═══════════════════════════════════════════════
   ROUTER
═══════════════════════════════════════════════ */

function route() {
  const hash = window.location.hash || "#/";
  const [rn, id] = hash.replace("#/", "").split("/");
  const pn = rn || "feed";
  Object.values(pages).forEach((p) => p?.classList.remove("active"));
  $$(".nav-link, .mobile-link").forEach((l) => l.classList.remove("active"));
  if (pn === "blog"    && id) return showBlog(id);
  if (pn === "edit"    && id) return requireAuth(() => showEdit(id));
  if (pn === "create")        return requireAuth(showCreate);
  if (pn === "profile")       return requireAuth(showProfile);
  if (pn === "starred")       return requireAuth(showStarredPage);
  if (pn === "login")         return showPage("login");
  if (pn === "signup")        return showPage("signup");
  showFeed();
}

function showPage(name) {
  pages[name]?.classList.add("active");
  $(`[data-nav="${name === "feed" ? "feed" : name}"]`)?.classList.add("active");
  window.scrollTo({ top: 0, behavior: "instant" });
}

function requireAuth(cb) {
  if (!state.token) { toast("Please log in first.", "error"); window.location.hash = "#/login"; return; }
  cb();
}

/* ═══════════════════════════════════════════════
   FEED
═══════════════════════════════════════════════ */

function showFeed() { showPage("feed"); loadFeed(); }

async function loadFeed() {
  const grid    = $("#blog-grid");
  const emptyEl = $("#feed-empty");
  const key     = feedCacheKey();
  const hit     = cacheGet(key);

  if (emptyEl) emptyEl.style.display = "none";

  // Only show skeletons on a genuine cold load. If we have cached data we
  // paint it immediately, so skeletons would just cause a needless flash.
  if (!hit) showSkeletons(grid, state.limit >= 6 ? 6 : state.limit);

  const paint = (data, meta = {}) => {
    state.blogs = normalizeBlogs(data.blogs || []);
    state.total = data.total || 0;
    renderBlogGrid(grid, state.blogs, { editable: false });
    renderPagination();
    clearBusy(grid);

    const cp = $("#feed-result-count");
    if (cp) {
      cp.innerHTML = `Showing <span>${state.blogs.length}</span> ${state.blogs.length === 1 ? "article" : "articles"}`;
    }
    if (emptyEl) emptyEl.style.display = state.blogs.length ? "none" : "";

    // thin progress line while a stale list refreshes behind the scenes
    grid?.classList.toggle("grid-revalidating", Boolean(meta.fromCache && hit?.stale));
    if (meta.revalidated) grid?.classList.remove("grid-revalidating");
  };

  try {
    await cachedFetch(key, () => {
      const params = new URLSearchParams({
        page: state.page, limit: state.limit, search: state.search, sort: state.sort,
      });
      return api(`/blogs?${params}`);
    }, paint);
  } catch (err) {
    toast(err.message, "error");
    if (grid) grid.innerHTML = "";
    clearBusy(grid);
    if (emptyEl) emptyEl.style.display = "";
  } finally {
    grid?.classList.remove("grid-revalidating");
  }
}

/* ═══════════════════════════════════════════════
   BLOG CARDS
═══════════════════════════════════════════════ */

/* Reveal cards as they enter the viewport instead of animating every card
   on load. Offscreen cards stay cheap (paired with content-visibility). */
function observeReveal(root) {
  const cards = $$(".blog-card", root);
  if (!("IntersectionObserver" in window)) {
    cards.forEach((c) => c.classList.add("revealed"));
    return;
  }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const i  = Number(el.dataset.revealIndex || 0);
        // small stagger, capped so later cards don't feel laggy
        setTimeout(() => el.classList.add("revealed"), Math.min(i, 7) * 55);
        revealObserver.unobserve(el);
      });
    }, { rootMargin: "80px 0px", threshold: 0.05 });
  }
  cards.forEach((card, i) => {
    card.dataset.revealIndex = i;
    revealObserver.observe(card);
  });

  // Safety net: cards start at opacity 0, so if the observer never fires
  // (hidden tab, odd layout, observer quirk) force them visible.
  setTimeout(() => cards.forEach((c) => c.classList.add("revealed")), 1200);
}

/* Reveal any cards inside a container that just became visible */
function revealAllIn(sel) {
  $$(`${sel} .blog-card`).forEach((c) => c.classList.add("revealed"));
}

function renderBlogGrid(root, blogs, options) {
  if (!root) return;
  root.innerHTML = blogs.map((b) => blogCard(b, options)).join("");
  observeReveal(root);
  $$("[data-star]", root).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      toggleStar(Number(btn.dataset.star), btn.dataset.starred === "true", btn);
    });
  });
  $$("[data-delete]", root).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      confirmDelete(Number(btn.dataset.delete));
    });
  });
}

function blogCard(blog, { editable = false } = {}) {
  const image    = primaryImage(blog);
  const owner    = blog.owner || {};
  const readTime = calcReadTime(blog.content);
  const starred  = Boolean(blog.is_starred);

  const imgCount = sortImages(blog.images).length;

  // Always show the image at full 16:9 when available.
  // decoding="async" + lazy loading keeps the feed responsive while images stream in.
  const thumbHtml = image
    ? `<div class="blog-thumb">
         <img src="${escAttr(image)}" alt="${escAttr(blog.title)}" loading="lazy" decoding="async"
              onerror="this.style.display='none'" />
         <span class="blog-thumb-badge">${readTime}</span>
         ${imgCount > 1 ? `<span class="blog-thumb-count">
           <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
           ${imgCount}</span>` : ""}
       </div>`
    : `<div class="blog-thumb-placeholder">
         <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
           <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
         </svg>
       </div>`;

  const sf = starred ? "#d97706" : "none";
  const ss = starred ? "#d97706" : "currentColor";
  const starSvg = `<svg width="17" height="17" viewBox="0 0 24 24" fill="${sf}" stroke="${ss}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

  const editHtml = editable
    ? `<div style="display:flex;gap:8px;">
         <a class="btn btn-ghost btn-sm" href="#/edit/${blog.id}">Edit</a>
         <button class="btn btn-danger btn-sm" data-delete="${blog.id}">Delete</button>
       </div>` : "";

  return `
    <article class="blog-card" aria-label="${escAttr(blog.title)}">
      <a class="blog-card-link" href="#/blog/${blog.id}">
        ${thumbHtml}
        <div class="blog-body">
          <h3 class="blog-title">${escHtml(blog.title)}</h3>
          <p class="blog-excerpt">${escHtml(blog.content || "")}</p>
          <div class="blog-meta">
            <span class="blog-author">
              <img class="author-avatar" src="${escAttr(avatarFor(owner))}" alt="${escAttr(owner.username || "Author")}" loading="lazy" />
              <span>${escHtml(owner.username || "Writer")}</span>
            </span>
            <span>${timeAgo(blog.created_at)}</span>
          </div>
        </div>
      </a>
      <div class="blog-card-actions">
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="icon-btn${starred ? " active" : ""}" data-star="${blog.id}" data-starred="${starred}"
            aria-label="${starred ? "Remove star" : "Star article"}" aria-pressed="${starred}">${starSvg}</button>
          <span style="font-size:0.86rem;color:var(--text-muted);font-weight:700;">${blog.star_count ?? 0}</span>
        </div>
        ${editHtml}
      </div>
    </article>`;
}

function renderPagination() {
  const el = $("#pagination");
  if (!el) return;
  const total = Math.max(1, Math.ceil(state.total / state.limit));
  if (total <= 1) { el.innerHTML = ""; return; }
  el.innerHTML = Array.from({ length: total }, (_, i) => {
    const p = i + 1;
    return `<button class="page-btn${p === state.page ? " active" : ""}" data-page="${p}">${p}</button>`;
  }).join("");
  $$("#pagination .page-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.page = Number(btn.dataset.page);
      loadFeed();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

/* ═══════════════════════════════════════════════
   BLOG DETAIL
═══════════════════════════════════════════════ */

async function showBlog(id) {
  showPage("blog");
  const skeleton = $("#blog-detail-skeleton");
  const content  = $("#blog-detail-content");
  const key      = `blog:${id}`;
  const hit      = cacheGet(key);

  // Cached post: render instantly, skip the skeleton entirely
  if (hit) {
    if (skeleton) skeleton.style.display = "none";
    if (content)  content.style.display  = "";
  } else {
    if (skeleton) skeleton.style.display = "";
    if (content)  content.style.display  = "none";
  }

  const paint = (blog) => {
    state.currentBlog = blog;
    if (content) {
      content.innerHTML = blogDetailHtml(blog);
      content.style.display = "";
    }
    if (skeleton) skeleton.style.display = "none";

    const starBtn = $("[data-detail-star]");
    starBtn?.addEventListener("click", () => toggleStar(blog.id, blog.is_starred, starBtn, true));
    $("[data-detail-delete]")?.addEventListener("click", () => confirmDelete(blog.id));
    $$(".blog-detail-image, .detail-gallery img").forEach((img) =>
      img.addEventListener("click", () => openLightbox(img.src))
    );
  };

  try {
    await cachedFetch(key, () => api(`/blogs/${id}`), paint);
  } catch (err) {
    if (content) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><h3>Post unavailable</h3><p>${escHtml(err.message)}</p><a href="#/" class="btn btn-primary btn-sm" style="margin-top:20px;">Back to feed</a></div>`;
      content.style.display = "";
    }
  } finally { if (skeleton) skeleton.style.display = "none"; }
}

function blogDetailHtml(blog) {
  const image   = primaryImage(blog);
  const isOwner = state.user?.id && blog.owner?.id === state.user.id;
  // Cover is rendered above; the gallery shows the remaining images
  const allImgs = sortImages(blog.images);
  const gallery = allImgs.slice(1).map((img, i) =>
    `<img src="${escAttr(fixImageUrl(img.image_url))}" alt="Image ${i + 2} of ${allImgs.length}" loading="lazy" decoding="async">`
  ).join("");
  const starred = Boolean(blog.is_starred);
  const dsf     = starred ? "currentColor" : "none";
  const dStar   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="${dsf}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  const ownerHtml = isOwner
    ? `<a class="btn btn-ghost btn-sm" href="#/edit/${blog.id}" style="display:inline-flex;gap:7px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</a>
       <button class="btn btn-danger btn-sm" data-detail-delete style="display:inline-flex;gap:7px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>Delete</button>` : "";
  return `
    <article class="blog-detail-hero">
      ${image ? `<img class="blog-detail-image" src="${escAttr(image)}" alt="${escAttr(blog.title)}" />` : ""}
      <div class="blog-detail-body">
        <a class="btn btn-ghost btn-sm" href="#/" style="margin-bottom:22px;display:inline-flex;gap:7px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>Back to feed
        </a>
        <h1 class="blog-detail-title">${escHtml(blog.title)}</h1>
        <div class="blog-detail-meta">
          <div style="display:flex;align-items:center;gap:14px;">
            <img class="author-avatar" style="width:44px;height:44px;border-width:2px;"
              src="${escAttr(avatarFor(blog.owner))}" alt="${escAttr(blog.owner?.username || "Author")}" />
            <div>
              <div style="font-weight:800;color:var(--text-primary);font-size:0.97rem;">${escHtml(blog.owner?.username || "Writer")}</div>
              <div style="font-size:0.83rem;color:var(--text-muted);">${formatDate(blog.created_at)} &bull; ${calcReadTime(blog.content)}</div>
            </div>
          </div>
          <div class="detail-actions">
            <button class="btn ${starred ? "btn-primary" : "btn-secondary"} btn-sm" data-detail-star
              style="display:flex;align-items:center;gap:7px;" aria-pressed="${starred}">
              ${dStar}<span>${starred ? "Starred" : "Star"}</span><span style="opacity:0.75;">(${blog.star_count ?? 0})</span>
            </button>
            ${ownerHtml}
          </div>
        </div>
        <div class="blog-detail-content">${escHtml(blog.content || "")}</div>
        ${gallery ? `<h3 style="margin-top:44px;font-weight:800;font-size:1.05rem;">Gallery <span style="color:var(--text-dim);font-weight:600;font-size:0.85rem;">(${allImgs.length} images)</span></h3><div class="detail-gallery">${gallery}</div>` : ""}
      </div>
    </article>`;
}

/* ═══════════════════════════════════════════════
   CREATE
═══════════════════════════════════════════════ */

function showCreate() {
  showPage("create");
  $("#create-form")?.reset();

  // release any previously queued object URLs
  state.pendingFiles.forEach((p) => URL.revokeObjectURL(p.preview));
  state.pendingFiles = [];

  const ce = $("#create-title-count"); if (ce) ce.textContent = "0";
  const ve = $("#visibility-value");   if (ve) ve.textContent = "Public";
  const up = $("#upload-progress");    if (up) up.style.display = "none";

  renderPendingImages();
}

async function onCreateBlog(e) {
  e.preventDefault();
  const title   = $("#create-title")?.value.trim();
  const content = $("#create-content")?.value.trim();
  if (!title || !content) return toast("Title and content are required.", "error");

  const btn      = $("#publish-btn");
  const files    = state.pendingFiles.map((p) => p.file);
  const progress = $("#upload-progress");
  const bar      = $("#upload-progress-bar");
  const pct      = $("#upload-progress-pct");
  const label    = $("#upload-progress-label");

  setLoading(btn, true);
  try {
    // 1. Create the post. `thumbnail` is Optional[str] with no default in
    //    BlogCreate, so the key must be present — and BlogResponse doesn't
    //    return it anyway, so images are the real source of truth.
    const blog = await api("/blogs", {
      method: "POST",
      body: JSON.stringify({
        title,
        content,
        visibility: $("#create-visibility")?.checked ?? true,
        thumbnail: null,
        images: [],
      }),
    });

    // 2. Upload the queued files as real multipart uploads -> Supabase URLs.
    if (files.length) {
      if (progress) progress.style.display = "";
      if (label) label.textContent = `Uploading ${files.length} image${files.length > 1 ? "s" : ""}…`;
      if (bar) bar.style.width = "0%";
      try {
        await uploadImagesForBlog(blog.id, files, { bar, pct });
      } catch (uploadErr) {
        // Post exists; only the images failed. Don't lose the user's writing.
        toast(`Post published, but images failed: ${uploadErr.message}`, "error");
        state.pendingFiles.forEach((p) => URL.revokeObjectURL(p.preview));
        state.pendingFiles = [];
        cacheInvalidate("feed:", "me:blogs");
        window.location.hash = `#/blog/${blog.id}`;
        return;
      }
    }

    state.pendingFiles.forEach((p) => URL.revokeObjectURL(p.preview));
    state.pendingFiles = [];
    cacheInvalidate("feed:", "me:blogs");   // new post must appear in lists
    toast(files.length ? "Article published with images!" : "Article published!", "success");
    window.location.hash = `#/blog/${blog.id}`;
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setLoading(btn, false);
    if (progress) progress.style.display = "none";
  }
}

function updateCreatePreview() {
  const title   = $("#create-title")?.value.trim();
  const content = $("#create-content")?.value.trim();
  const thumb   = state.pendingFiles[0]?.preview || "";
  const extra   = Math.max(0, state.pendingFiles.length - 1);
  const preview = $("#preview-body");
  if (!preview) return;
  if (!title && !content && !thumb) {
    preview.innerHTML = `<p style="color:var(--text-dim);font-size:0.9rem;">Start typing to see a live preview.</p>`;
    return;
  }
  preview.innerHTML = `
    ${thumb ? `
      <div style="position:relative;margin-bottom:14px;">
        <img src="${escAttr(thumb)}" style="width:100%;height:160px;object-fit:cover;border-radius:var(--r-lg);display:block;" alt="Cover preview" />
        ${extra ? `<span style="position:absolute;bottom:8px;right:8px;padding:3px 10px;border-radius:var(--r-full);background:rgba(15,23,42,0.78);color:#fff;font-size:0.7rem;font-weight:800;">+${extra} more</span>` : ""}
      </div>` : ""}
    <h2 style="font-size:1.25rem;font-weight:800;margin-bottom:10px;letter-spacing:-0.02em;">${escHtml(title || "Untitled")}</h2>
    <div style="font-size:0.9rem;color:var(--text-muted);white-space:pre-wrap;line-height:1.65;">${escHtml((content || "").slice(0, 300))}${(content || "").length > 300 ? "…" : ""}</div>`;
}

/* ═══════════════════════════════════════════════
   EDIT
═══════════════════════════════════════════════ */

async function showEdit(id) {
  showPage("edit");
  try {
    const blog = await api(`/blogs/${id}`);
    state.editingBlog = blog;
    const t  = $("#edit-title");           if (t)  t.value    = blog.title   || "";
    const c  = $("#edit-content");         if (c)  c.value    = blog.content || "";
    const v  = $("#edit-visibility");      if (v)  v.checked  = Boolean(blog.visibility);
    const vv = $("#edit-visibility-value");if (vv) vv.textContent = blog.visibility ? "Public" : "Private";
    renderEditImages(blog.images || []);
  } catch (err) { toast(err.message, "error"); window.location.hash = "#/"; }
}

async function onUpdateBlog(e) {
  e.preventDefault();
  if (!state.editingBlog) return;
  const btn = $("#update-btn");
  setLoading(btn, true);
  try {
    await api(`/blogs/${state.editingBlog.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: $("#edit-title")?.value.trim(), content: $("#edit-content")?.value.trim(), visibility: $("#edit-visibility")?.checked }),
    });
    cacheInvalidate("feed:", "me:blogs", "me:starred", `blog:${state.editingBlog.id}`);
    toast("Article updated.", "success");
    window.location.hash = `#/blog/${state.editingBlog.id}`;
  } catch (err) { toast(err.message, "error"); }
  finally { setLoading(btn, false); }
}

/* ═══════════════════════════════════════════════
   PROFILE
═══════════════════════════════════════════════ */

async function showProfile() {
  showPage("profile");
  renderProfileHeader();
  await Promise.all([loadMyBlogs(), loadStarredBlogs()]);
}

function renderProfileHeader() {
  const user = state.user || {};
  const p = $("#avatar-edit-preview"); if (p) p.src = state.pendingAvatarDataUrl || avatarFor(user);
  const a = $("#profile-avatar");    if (a)  a.src          = state.pendingAvatarDataUrl || avatarFor(user);
  const n = $("#profile-username");  if (n)  n.textContent  = user.username || user.email?.split("@")[0] || "Writer";
  const em= $("#profile-email");     if (em) em.textContent = user.email || "Signed in";
  const b = $("#profile-bio");       if (b)  b.textContent  = user.bio || "No bio added yet.";
  const j = $("#profile-joined");    if (j)  j.textContent  = user.created_at ? `Member since ${formatDate(user.created_at)}` : "";
}

function showProfileEditor() {
  const user  = state.user || {};
  const panel = $("#profile-edit");
  if (!panel) return;
  panel.style.display = "block";

  const u = $("#edit-username"); if (u) u.value = user.username || "";
  const b = $("#edit-bio");      if (b) b.value = user.bio      || "";

  // seed the photo preview with the staged image, else the saved one
  const preview = $("#avatar-edit-preview");
  if (preview) preview.src = state.pendingAvatarDataUrl || avatarFor(user);

  const actions = $("#avatar-edit-actions");
  if (actions) actions.style.display = state.pendingAvatarDataUrl ? "" : "none";

  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function onSaveProfile(e) {
  e.preventDefault();
  const btn = $("#save-profile-btn");
  setLoading(btn, true);
  try {
    // Only send keys that actually have values. The backend uses
    // model_dump(exclude_unset=True), which drops *omitted* fields but still
    // writes explicit nulls — and `username` is NOT NULL in the DB.
    const payload = {};

    const username = $("#edit-username")?.value.trim();
    if (username) payload.username = username;

    const bio = $("#edit-bio")?.value.trim();
    if (bio !== undefined) payload.bio = bio; // "" is valid: clears the bio

    if (state.pendingAvatarDataUrl) payload.profile_image = state.pendingAvatarDataUrl;

    if (!Object.keys(payload).length) {
      toast("Nothing to save.", "");
      setLoading(btn, false);
      return;
    }
    const user = await api("/users/me", { method: "PATCH", body: JSON.stringify(payload) });
    state.user = user;
    state.pendingAvatarDataUrl = null;

    const actions = $("#avatar-edit-actions");
    if (actions) actions.style.display = "none";

    // author name/photo is embedded in every cached list
    cacheInvalidate("feed:", "me:blogs", "me:starred", "blog:", "user:");
    cacheSet(`user:${user.id}`, user);

    renderAuth();
    renderProfileHeader();
    $("#profile-edit").style.display = "none";
    toast("Profile saved.", "success");

    // repaint lists so the new name/photo shows straight away
    loadMyBlogs();
    loadStarredBlogs();
  } catch (err) { toast(err.message, "error"); }
  finally { setLoading(btn, false); }
}

/* /users/me/blogs and /users/me/starred have no response_model, so FastAPI
   serialises the bare ORM rows: no images, no owner, no star_count. Fill those
   in from /blogs/{id}, which also warms the detail cache for instant clicks. */
async function hydrateBlogDetails(list, onDone, options) {
  const out = list.slice();
  const CONCURRENCY = 5;
  let cursor = 0;
  let changed = false;

  const worker = async () => {
    while (cursor < out.length) {
      const idx  = cursor++;
      const item = out[idx];
      if (!item) continue;
      // Raw rows from the list endpoints lack both of these; a hydrated
      // record has them. Checking before normalisation matters, because
      // normalizeBlogs() always fills `images` with at least [].
      if (item.images !== undefined && item.star_count !== undefined) continue;

      const key = `blog:${item.id}`;
      const hit = cacheGet(key);
      if (hit && !hit.stale) {
        out[idx] = { ...item, ...hit.data };
        changed = true;
        continue;
      }
      try {
        const full = await api(`/blogs/${item.id}`);
        cacheSet(key, full);
        out[idx] = { ...item, ...full };
        changed = true;
      } catch {
        /* keep the partial row rather than dropping the card */
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, out.length) }, worker)
  );

  if (changed) onDone(normalizeBlogs(out), options);
  return out;
}

async function loadMyBlogs() {
  const root  = $("#my-blogs-grid");
  const empty = $("#my-blogs-empty");
  const key   = "me:blogs";
  if (!cacheGet(key)) showSkeletons(root, 3);
  if (empty) empty.style.display = "none";
  try {
    const blogs = await cachedFetch(key, () => api("/users/me/blogs"), (raw) => {
      const list = normalizeBlogs(raw);
      renderBlogGrid(root, list, { editable: true });
      clearBusy(root);
      if (empty) empty.style.display = list.length ? "none" : "";
    });
    // pull in images/stars that the list endpoint omits (raw rows, pre-normalise)
    await hydrateBlogDetails(blogs || [], (full) => {
      renderBlogGrid(root, full, { editable: true });
    });
  } catch {
    if (root) root.innerHTML = "";
    clearBusy(root);
    if (empty) empty.style.display = "";
  }
}

async function loadStarredBlogs() {
  const root  = $("#starred-blogs-grid");
  const empty = $("#starred-blogs-empty");
  const key   = "me:starred";
  if (!cacheGet(key)) showSkeletons(root, 3);
  if (empty) empty.style.display = "none";
  try {
    const blogs = await cachedFetch(key, () => api("/users/me/starred"), (raw) => {
      const list = normalizeBlogs(raw);
      renderBlogGrid(root, list, { editable: false });
      clearBusy(root);
      if (empty) empty.style.display = list.length ? "none" : "";
    });
    await hydrateBlogDetails(blogs || [], (full) => {
      renderBlogGrid(root, full, { editable: false });
    });
  } catch {
    if (root) root.innerHTML = "";
    clearBusy(root);
    if (empty) empty.style.display = "";
  }
}

function setProfileTab(tab) {
  $$(".profile-tabs .tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
    b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  });
  const my  = $("#tab-my-blogs");
  const st  = $("#tab-starred-blogs");
  if (my) my.style.display = tab === "my-blogs"      ? "block" : "none";
  if (st) st.style.display = tab === "starred-blogs" ? "block" : "none";
  // cards rendered while the tab was hidden never intersected — reveal them now
  revealAllIn(tab === "my-blogs" ? "#tab-my-blogs" : "#tab-starred-blogs");
}

async function showStarredPage() {
  showPage("starred");
  const grid  = $("#starred-page-grid");
  const empty = $("#starred-page-empty");
  const key   = "me:starred";
  if (!cacheGet(key)) showSkeletons(grid, 3);
  if (empty) empty.style.display = "none";
  try {
    const blogs = await cachedFetch(key, () => api("/users/me/starred"), (raw) => {
      const list = normalizeBlogs(raw);
      renderBlogGrid(grid, list, { editable: false });
      clearBusy(grid);
      if (empty) empty.style.display = list.length ? "none" : "";
    });
    await hydrateBlogDetails(blogs || [], (full) => {
      renderBlogGrid(grid, full, { editable: false });
    });
  } catch {
    if (grid) grid.innerHTML = "";
    clearBusy(grid);
    if (empty) empty.style.display = "";
  }
}

/* ═══════════════════════════════════════════════
   STAR TOGGLE
═══════════════════════════════════════════════ */

async function toggleStar(blogId, isStarred, triggerBtn, refreshDetail = false) {
  if (!state.token) { toast("Please log in to star articles.", "error"); window.location.hash = "#/login"; return; }
  if (triggerBtn) {
    triggerBtn.classList.add("star-animate");
    triggerBtn.addEventListener("animationend", () => triggerBtn.classList.remove("star-animate"), { once: true });
  }
  try {
    await api(`/blogs/${blogId}/star`, { method: isStarred ? "DELETE" : "POST" });
    const nowStarred = !isStarred;
    // star counts live in every cached list, so drop them all
    cacheInvalidate("feed:", "me:starred", "me:blogs", `blog:${blogId}`);
    toast(nowStarred ? "Starred!" : "Removed star.", nowStarred ? "success" : "");

    // update all card star buttons
    document.querySelectorAll(`[data-star="${blogId}"]`).forEach((btn) => {
      btn.dataset.starred = String(nowStarred);
      btn.classList.toggle("active", nowStarred);
      btn.setAttribute("aria-pressed", String(nowStarred));
      const svg = btn.querySelector("svg");
      if (svg) { svg.setAttribute("fill", nowStarred ? "#d97706" : "none"); svg.setAttribute("stroke", nowStarred ? "#d97706" : "currentColor"); }
      const countEl = btn.nextElementSibling;
      if (countEl && /^\d+$/.test(countEl.textContent.trim())) {
        const cur = parseInt(countEl.textContent, 10) || 0;
        countEl.textContent = nowStarred ? cur + 1 : Math.max(0, cur - 1);
      }
    });

    // update detail star button
    const detailBtn = document.querySelector("[data-detail-star]");
    if (detailBtn) {
      const svg  = detailBtn.querySelector("svg");
      const spans = detailBtn.querySelectorAll("span");
      if (svg)     svg.setAttribute("fill", nowStarred ? "currentColor" : "none");
      if (spans[0]) spans[0].textContent = nowStarred ? "Starred" : "Star";
      if (spans[1]) {
        const cur = parseInt((spans[1].textContent || "").replace(/\D/g, ""), 10) || 0;
        spans[1].textContent = `(${nowStarred ? cur + 1 : Math.max(0, cur - 1)})`;
      }
      detailBtn.className = `btn ${nowStarred ? "btn-primary" : "btn-secondary"} btn-sm`;
      detailBtn.style.cssText = "display:flex;align-items:center;gap:7px;";
      detailBtn.setAttribute("aria-pressed", String(nowStarred));
    }

    // update in-memory state
    const b = state.blogs.find((x) => x.id === blogId);
    if (b) { b.is_starred = nowStarred; b.star_count = nowStarred ? (b.star_count ?? 0) + 1 : Math.max(0, (b.star_count ?? 1) - 1); }
  } catch (err) { toast(err.message, "error"); }
}

/* ═══════════════════════════════════════════════
   DELETE
═══════════════════════════════════════════════ */

function confirmDelete(blogId) {
  const modal     = $("#confirm-modal");
  const okBtn     = $("#confirm-ok");
  const cancelBtn = $("#confirm-cancel");
  if (!modal) return;
  modal.classList.add("active");
  const cleanup = () => modal.classList.remove("active");
  okBtn.onclick = async () => {
    cleanup();
    try {
      await api(`/blogs/${blogId}`, { method: "DELETE" });
      cacheInvalidate("feed:", "me:blogs", "me:starred", `blog:${blogId}`);
      toast("Article deleted.", "success");
      if ((window.location.hash || "").includes(`blog/${blogId}`)) window.location.hash = "#/";
      else showProfile();
    } catch (err) { toast(err.message, "error"); }
  };
  cancelBtn.onclick = cleanup;
}

/* ═══════════════════════════════════════════════
   LIGHTBOX
═══════════════════════════════════════════════ */

function openLightbox(src) {
  if (!src) return;
  const modal = $("#lightbox-modal");
  const img   = $("#lightbox-img");
  if (img)   img.src = src;
  if (modal) modal.classList.add("active");
}

function closeLightbox() {
  $("#lightbox-modal")?.classList.remove("active");
}

/* ═══════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════ */

/* Sort images by display_order so the cover is deterministic.
   The backend assigns display_order incrementally on upload. */
function sortImages(images) {
  return (images || [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
}

/* Resolve a blog's cover image.
   NOTE: BlogResponse (schemas.py) does NOT include `thumbnail`, so the API
   never sends it — `images` is the only image source that survives the
   response model. We still check `thumbnail` last in case that changes. */
function primaryImage(blog) {
  if (!blog) return "";

  const imgs = sortImages(blog.images);
  for (const entry of imgs) {
    const url = typeof entry === "string" ? entry : (entry?.image_url || entry?.url || "");
    if (url && String(url).trim()) return fixImageUrl(String(url).trim());
  }

  if (blog.thumbnail && typeof blog.thumbnail === "string" && blog.thumbnail.trim())
    return fixImageUrl(blog.thumbnail.trim());

  return "";
}

function fixImageUrl(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) return url;
  if (url.startsWith("/")) return `${API_BASE}${url}`;
  return `${API_BASE}/${url}`;
}

function avatarFor(user) {
  user = user || {};
  if (user.profile_image) return user.profile_image;
  const label = (user.username || user.email || "W").slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="#dbeafe"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="#1e40af" font-family="Arial,sans-serif" font-size="32" font-weight="700">${escHtml(label)}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function normalizeBlogs(blogs) {
  return (blogs || []).map((b) => ({
    ...b,
    owner:      b.owner || state.user,
    images:     sortImages(b.images),
    star_count: b.star_count ?? b.stars?.length ?? 0,
  }));
}

function calcReadTime(text) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.ceil(words / 200))} min read`;
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const secs = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (secs < 60)   return "Just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400)return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 2592000) return `${Math.floor(secs / 86400)}d ago`;
  return formatDate(dateStr);
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function parseJwt(token) {
  try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); }
  catch { return null; }
}

function escHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escAttr(v) { return escHtml(v).replace(/`/g, "&#096;"); }

function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle("is-loading", loading);
}

function toast(message, type) {
  const container = $("#toast-container");
  if (!container) return;

  const icons = {
    success: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    default: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };

  const node = document.createElement("div");
  node.className = `toast${type ? " " + type : ""}`;
  node.innerHTML = `<span class="toast-icon">${icons[type] || icons.default}</span><span>${escHtml(message)}</span>`;
  container.appendChild(node);

  // fade-out before removal
  setTimeout(() => {
    node.style.transition = "opacity 0.3s, transform 0.3s";
    node.style.opacity = "0";
    node.style.transform = "translateX(30px)";
    setTimeout(() => node.remove(), 320);
  }, 2900);
}

function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}
