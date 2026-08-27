/* =====================================================================
   Luminova — app.js
   Vanilla SPA, hash routing, no build step. Loaded as a classic script
   on purpose: API_BASE below falls back to 127.0.0.1 so index.html still
   works opened straight off disk, which ES modules would break.
   ===================================================================== */

/* ---------------------------------------------------------------- config */

const defaultHost =
  window.location.hostname &&
  window.location.hostname !== "file:" &&
  window.location.hostname !== ""
    ? window.location.hostname
    : "127.0.0.1";

const API_BASE = localStorage.getItem("blogs_api_base") || `http://${defaultHost}:8000`;
const TOKEN_KEY = "blogs_access_token";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const AVATAR_PX = 160;
const PER_PAGE = 9;

/* ----------------------------------------------------------------- state */

const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: null,
  page: 1,
  limit: PER_PAGE,
  search: "",
  sort: "newest",
  feed: { blogs: [], total: 0, page: 1, limit: PER_PAGE },
  currentBlog: null,
  editBlog: null,
  profileTab: "my-blogs",
  ownBlogs: [],
  starredBlogs: [],
  gallery: [],
  galleryIndex: 0,
  createBay: null,
  editBay: null,
};

/* ------------------------------------------------------------- utilities */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function prefersReduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setLoading(button, loading) {
  if (!button) return;
  button.classList.toggle("is-loading", loading);
  button.disabled = loading;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function readTime(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/* Supabase's get_public_url sometimes returns a bare trailing "?" */
function fixImageUrl(url) {
  return url ? String(url).replace(/\?$/, "") : "";
}

function sortImages(images) {
  return [...(images || [])].sort(
    (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || (a.id ?? 0) - (b.id ?? 0)
  );
}

/* BlogResponse carries no thumbnail field, so the cover is simply the image
   with the lowest display_order — not whatever happens to be first. */
function primaryImage(blog) {
  const first = sortImages(blog?.images)[0];
  return first ? fixImageUrl(first.image_url) : "";
}

function avatarFor(user) {
  if (user?.profile_image) return fixImageUrl(user.profile_image);
  const initial = (user?.username || user?.email || "?").trim().charAt(0).toUpperCase() || "?";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">` +
    `<rect width="120" height="120" fill="#E4DFD2"/>` +
    `<text x="60" y="84" text-anchor="middle" font-family="Archivo, Helvetica, sans-serif"` +
    ` font-size="64" font-weight="900" fill="#12121A">${escapeHtml(initial)}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/* ------------------------------------------------------------------- api */

async function api(path, options = {}) {
  const { method = "GET", body, auth = true, form = false } = options;
  const headers = {};

  if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;
  if (!form && body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: form ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Cannot reach the API at ${API_BASE}. Start the server and try again.`);
  }

  if (response.status === 401 && auth && state.token) {
    clearSession();
    throw new Error("Your session expired. Log in again.");
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    let detail = payload?.detail ?? payload ?? response.statusText;
    if (Array.isArray(detail)) detail = detail.map((item) => item.msg || item).join(", ");
    if (typeof detail !== "string") detail = JSON.stringify(detail);
    throw new Error(detail || `Request failed (${response.status})`);
  }

  return payload;
}

/* ---------------------------------------------------------------- toasts */

function toast(message, kind = "", ms = 4200) {
  const stack = $("#toast-container");
  if (!stack) return;
  const node = el("div", `toast ${kind}`.trim());
  node.textContent = message;
  stack.appendChild(node);
  setTimeout(() => {
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 500);
  }, ms);
}

/* --------------------------------------------------------- confirm dialog */

let confirmResolve = null;
let confirmReturnFocus = null;

function confirmAction({ title, message, okLabel = "Delete", cancelLabel = "Keep it" }) {
  const overlay = $("#confirm-modal");
  $("#confirm-modal-title").textContent = title;
  $("#confirm-modal-message").textContent = message;
  $("#confirm-ok").textContent = okLabel;
  $("#confirm-cancel").textContent = cancelLabel;

  confirmReturnFocus = document.activeElement;
  overlay.hidden = false;
  requestAnimationFrame(() => $("#confirm-cancel").focus());

  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

function closeConfirm(result) {
  const overlay = $("#confirm-modal");
  if (overlay.hidden) return;
  overlay.hidden = true;
  const resolve = confirmResolve;
  confirmResolve = null;
  if (confirmReturnFocus?.focus) confirmReturnFocus.focus();
  if (resolve) resolve(result);
}

function trapFocus(container, event) {
  const focusable = $$(
    'a[href], button:not([disabled]), input:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])',
    container
  ).filter((node) => node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* -------------------------------------------------------------- lightbox */

let lightboxReturnFocus = null;

function openLightbox(urls, index) {
  if (!urls.length) return;
  state.gallery = urls;
  state.galleryIndex = Math.min(Math.max(index, 0), urls.length - 1);
  lightboxReturnFocus = document.activeElement;
  $("#lightbox").hidden = false;
  paintLightbox();
  $("#lightbox-close").focus();
}

function paintLightbox() {
  const total = state.gallery.length;
  const index = state.galleryIndex;
  $("#lightbox-img").src = state.gallery[index] || "";
  $("#lightbox-img").alt = `Image ${index + 1} of ${total}`;
  $("#lightbox-caption").textContent = `${pad2(index + 1)} / ${pad2(total)}`;
  $("#lightbox-prev").hidden = total < 2;
  $("#lightbox-next").hidden = total < 2;
}

function stepLightbox(delta) {
  const total = state.gallery.length;
  if (!total) return;
  state.galleryIndex = (state.galleryIndex + delta + total) % total;
  paintLightbox();
}

function closeLightbox() {
  if ($("#lightbox").hidden) return;
  $("#lightbox").hidden = true;
  $("#lightbox-img").src = "";
  if (lightboxReturnFocus?.focus) lightboxReturnFocus.focus();
}

/* ------------------------------------------------------------------ auth */

function parseJwt(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const utf8 = decodeURIComponent(
      raw
        .split("")
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join("")
    );
    return JSON.parse(utf8);
  } catch {
    return null;
  }
}

function isAuthed() {
  return Boolean(state.token);
}

function clearSession() {
  state.token = null;
  state.user = null;
  state.ownBlogs = [];
  state.starredBlogs = [];
  localStorage.removeItem(TOKEN_KEY);
  document.body.classList.remove("is-authenticated");
  paintAccount();
}

function requireAuth(message) {
  if (isAuthed()) return true;
  toast(message, "error");
  location.hash = "#/login";
  return false;
}

/* The signed-in user comes from the JWT (user_id, user_email) plus
   GET /users/{id} for username, bio, photo and join date. Reading it off a
   blog's owner would lose email and bio — BlogOwner has neither — and would
   give nothing at all to someone who has not published yet. */
async function hydrateAuth() {
  if (!state.token) {
    document.body.classList.remove("is-authenticated");
    paintAccount();
    return;
  }

  const claims = parseJwt(state.token);
  if (!claims?.user_id) {
    clearSession();
    return;
  }
  if (claims.exp && claims.exp * 1000 < Date.now()) {
    clearSession();
    toast("Your session expired. Log in again.", "error");
    return;
  }

  document.body.classList.add("is-authenticated");
  state.user = {
    id: claims.user_id,
    email: claims.user_email || "",
    username: (claims.user_email || "reader").split("@")[0],
    bio: null,
    profile_image: null,
    created_at: null,
  };
  paintAccount();

  try {
    const full = await api(`/users/${claims.user_id}`);
    state.user = { ...state.user, ...full, email: full.email || state.user.email };
    paintAccount();
  } catch {
    /* keep the JWT-derived stub — the account menu still works */
  }
}

function paintAccount() {
  const name = $("#nav-username");
  const image = $("#nav-avatar");
  if (name) name.textContent = state.user?.username || "";
  if (image) {
    image.src = avatarFor(state.user);
    image.alt = state.user?.username ? `${state.user.username}, your account` : "";
  }
}

/* ---------------------------------------------------------------- router */

const ROUTES = ["feed", "blog", "login", "signup", "create", "edit", "profile"];

function showPage(name) {
  const swap = () => {
    ROUTES.forEach((route_) =>
      document.getElementById(`page-${route_}`)?.classList.remove("active")
    );
    document.getElementById(`page-${name}`)?.classList.add("active");
    $$(".nav-link, .tray-link").forEach((link) =>
      link.classList.toggle("active", link.dataset.nav === name)
    );
    window.scrollTo(0, 0);
    $$(".ink-switch").forEach(positionSwitch);
  };

  if (document.startViewTransition && !prefersReduced()) {
    document.startViewTransition(swap);
  } else {
    swap();
  }
}

function route() {
  closeTray();
  closeMenu();
  closeLightbox();

  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const head = parts[0] || "";

  if (head === "blog" && parts[1]) {
    showPage("blog");
    renderBlogDetail(parts[1]);
    return;
  }
  if (head === "edit" && parts[1]) {
    if (!requireAuth("Log in to edit a story.")) return;
    showPage("edit");
    renderEditPage(parts[1]);
    return;
  }
  if (head === "create") {
    if (!requireAuth("Log in to publish a story.")) return;
    showPage("create");
    renderProof();
    return;
  }
  if (head === "profile") {
    if (!requireAuth("Log in to see your desk.")) return;
    showPage("profile");
    renderProfile();
    return;
  }
  if (head === "login" || head === "signup") {
    if (isAuthed()) {
      location.hash = "#/";
      return;
    }
    showPage(head);
    return;
  }

  showPage("feed");
  loadFeed();
}

/* --------------------------------------------------------- scroll reveal */

let revealObserver = null;

function observeReveals(root) {
  const targets = $$(".reveal:not(.is-revealed)", root);
  if (prefersReduced()) {
    targets.forEach((node) => node.classList.add("is-revealed"));
    return;
  }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const delay = Number(entry.target.dataset.revealDelay || 0);
          setTimeout(() => entry.target.classList.add("is-revealed"), delay);
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.04 }
    );
  }
  targets.forEach((node) => revealObserver.observe(node));
}

/* ------------------------------------------------------------ ink switch */

function positionSwitch(container) {
  const slider = $(".ink-switch-slider", container);
  const active = $(".ink-switch-btn.is-on", container);
  if (!slider || !active || !active.offsetWidth) return;
  slider.style.setProperty("--sw-w", `${active.offsetWidth}px`);
  slider.style.setProperty("--sw-x", `${active.offsetLeft}px`);
}

function selectSwitch(container, button) {
  $$(".ink-switch-btn", container).forEach((node) => {
    const on = node === button;
    node.classList.toggle("is-on", on);
    node.setAttribute("aria-selected", String(on));
  });
  positionSwitch(container);
}

/* ------------------------------------------------------------------ feed */

async function loadFeed() {
  const grid = $("#blog-grid");
  const skeleton = $("#feed-skeleton");

  $("#feed-empty").hidden = true;
  grid.innerHTML = "";
  skeleton.innerHTML = Array.from({ length: 6 })
    .map(
      () =>
        `<div class="sk-card">` +
        `<span class="sk sk-block"></span>` +
        `<span class="sk sk-line" style="width:88%;height:22px"></span>` +
        `<span class="sk sk-line" style="width:96%"></span>` +
        `<span class="sk sk-line" style="width:64%"></span>` +
        `</div>`
    )
    .join("");
  skeleton.style.display = "";

  const params = new URLSearchParams({
    page: String(state.page),
    limit: String(state.limit),
    sort: state.sort,
  });
  if (state.search) params.set("search", state.search);

  try {
    const data = await api(`/blogs?${params}`, { auth: isAuthed() });
    state.feed = data;
    skeleton.style.display = "none";
    skeleton.innerHTML = "";
    renderFeed(data);
  } catch (error) {
    skeleton.style.display = "none";
    skeleton.innerHTML = "";
    grid.innerHTML = "";
    $("#pagination").innerHTML = "";
    $("#feed-result-count").textContent = "";
    $("#feed-empty").hidden = false;
    toast(error.message, "error");
  }
}

function renderFeed(data) {
  const grid = $("#blog-grid");
  const blogs = data.blogs || [];
  const total = data.total || 0;

  $("#feed-result-count").textContent = state.search
    ? `${plural(total, "story", "stories")} matching "${state.search}"`
    : `${plural(total, "story", "stories")} in print`;
  $("#hero-eyebrow").textContent = `Independent press · ${plural(total, "story", "stories")}`;

  if (!blogs.length) {
    grid.innerHTML = "";
    $("#feed-empty").hidden = false;
    renderPagination(total);
    return;
  }

  $("#feed-empty").hidden = true;
  const offset = ((data.page || 1) - 1) * (data.limit || state.limit);
  grid.innerHTML = blogs.map((blog, i) => storyCard(blog, offset + i + 1, i)).join("");
  renderPagination(total);
  observeReveals(grid);
}

function storyCard(blog, position, indexInBatch = 0) {
  const cover = primaryImage(blog);
  const owner = blog.owner || {};
  const imageCount = (blog.images || []).length;
  const mine = state.user && owner.id === state.user.id;

  const flags = [];
  if (blog.visibility === false) flags.push('<span class="flag flag--private">Private</span>');
  if (imageCount > 1)
    flags.push(`<span class="flag flag--plates">${plural(imageCount, "image", "images")}</span>`);

  return `
  <article class="story-card reveal" data-card="${blog.id}" data-reveal-delay="${
    indexInBatch * 70
  }">
    <span class="card-index" aria-hidden="true">&#8470;&nbsp;${pad2(position)}</span>
    <a class="card-link" href="#/blog/${blog.id}">
      <span class="card-thumb${cover ? "" : " card-thumb--blank"}">
        ${
          cover
            ? `<img src="${escapeAttr(cover)}" alt="" loading="lazy" />`
            : `<span aria-hidden="true">${escapeHtml(
                (blog.title || "?").trim().charAt(0).toUpperCase()
              )}</span>`
        }
      </span>
      ${flags.length ? `<span class="card-flags">${flags.join("")}</span>` : ""}
      <h2 class="card-title"><span class="plate" data-plate="${escapeAttr(
        blog.title
      )}">${escapeHtml(blog.title)}</span></h2>
      <p class="card-excerpt">${escapeHtml(blog.content || "")}</p>
    </a>
    <div class="card-foot">
      <span class="byline">
        <img class="byline-avatar" src="${escapeAttr(avatarFor(owner))}" alt="" loading="lazy" />
        <span class="byline-text">
          <span class="byline-name">${escapeHtml(owner.username || "unknown")}</span>
          <span class="byline-date">${formatDate(blog.created_at)} &middot; ${readTime(
    blog.content
  )} min</span>
        </span>
      </span>
      <span class="card-tools">
        ${
          mine
            ? `<a class="icon-btn" href="#/edit/${blog.id}" aria-label="Edit ${escapeAttr(
                blog.title
              )}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg></a>`
            : ""
        }
        ${starButton(blog)}
      </span>
    </div>
  </article>`;
}

function starButton(blog, extraClass = "") {
  const classes = ["star-btn", blog.is_starred ? "is-on" : "", extraClass]
    .filter(Boolean)
    .join(" ");
  return `<button class="${classes}"
    data-star="${blog.id}" aria-pressed="${Boolean(blog.is_starred)}"
    aria-label="${blog.is_starred ? "Remove star from" : "Star"} ${escapeAttr(blog.title)}">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="${
      blog.is_starred ? "currentColor" : "none"
    }" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.9 5.9 6.6.9-4.8 4.6 1.2 6.5L12 17.8 6.1 20.9l1.2-6.5L2.5 9.8l6.6-.9L12 3z"/></svg>
    <span data-star-count="${blog.id}">${blog.star_count ?? 0}</span>
  </button>`;
}

function renderPagination(total) {
  const nav = $("#pagination");
  const limit = state.limit || PER_PAGE;
  const pages = Math.max(1, Math.ceil(total / limit));

  if (pages < 2) {
    nav.innerHTML = "";
    return;
  }

  const current = Math.min(state.page, pages);
  const shown = new Set([1, pages, current, current - 1, current + 1]);
  if (current <= 2) shown.add(3);
  if (current >= pages - 1) shown.add(pages - 2);

  const list = [...shown].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);

  let html = `<button class="page-btn" data-page="${current - 1}"${
    current === 1 ? " disabled" : ""
  } aria-label="Previous page">&#8249;</button>`;

  let previous = 0;
  list.forEach((page) => {
    if (page - previous > 1) html += `<span class="page-gap" aria-hidden="true">&hellip;</span>`;
    html += `<button class="page-btn${page === current ? " is-on" : ""}" data-page="${page}"${
      page === current ? ' aria-current="page"' : ""
    } aria-label="Page ${page}">${page}</button>`;
    previous = page;
  });

  html += `<button class="page-btn" data-page="${current + 1}"${
    current === pages ? " disabled" : ""
  } aria-label="Next page">&#8250;</button>`;

  nav.innerHTML = html;
}

/* ------------------------------------------------------------------ stars */

function applyStar(blog, starred) {
  blog.is_starred = starred;
  blog.star_count = Math.max(0, (blog.star_count ?? 0) + (starred ? 1 : -1));

  $$(`[data-star="${blog.id}"]`).forEach((button) => {
    button.classList.toggle("is-on", starred);
    button.setAttribute("aria-pressed", String(starred));
    $("svg", button)?.setAttribute("fill", starred ? "currentColor" : "none");
    button.setAttribute(
      "aria-label",
      `${starred ? "Remove star from" : "Star"} ${blog.title || "this story"}`
    );
    if (starred) {
      button.classList.add("just-starred");
      setTimeout(() => button.classList.remove("just-starred"), 560);
    }
  });

  $$(`[data-star-count="${blog.id}"]`).forEach((node) => {
    node.textContent = blog.star_count;
  });
}

function findBlogRecords(id) {
  const numeric = Number(id);
  const records = [];
  [state.feed.blogs || [], state.ownBlogs, state.starredBlogs].forEach((pool) =>
    pool.forEach((blog) => blog.id === numeric && records.push(blog))
  );
  if (state.currentBlog?.id === numeric) records.push(state.currentBlog);
  return records;
}

async function toggleStar(id) {
  if (!requireAuth("Log in to star a story.")) return;

  const records = findBlogRecords(id);
  if (!records.length) return;
  const next = !records[0].is_starred;

  records.forEach((blog) => applyStar(blog, next));

  try {
    await api(`/blogs/${id}/star`, { method: next ? "POST" : "DELETE" });
  } catch (error) {
    records.forEach((blog) => applyStar(blog, !next));
    toast(error.message, "error");
  }
}

/* ----------------------------------------------------------- blog detail */

async function renderBlogDetail(id) {
  const skeleton = $("#blog-detail-skeleton");
  const holder = $("#blog-detail-content");
  skeleton.style.display = "";
  holder.hidden = true;
  holder.innerHTML = "";

  try {
    const blog = await api(`/blogs/${id}`, { auth: isAuthed() });
    state.currentBlog = blog;
    skeleton.style.display = "none";
    holder.hidden = false;
    holder.innerHTML = blogDetailMarkup(blog);
  } catch (error) {
    state.currentBlog = null;
    skeleton.style.display = "none";
    holder.hidden = false;
    holder.innerHTML = `
      <div class="blank-state">
        <p class="blank-mark" aria-hidden="true">&#9633;</p>
        <h3>Story not available</h3>
        <p>${escapeHtml(error.message)}</p>
        <a href="#/" class="btn btn-ink btn-sm">Back to the feed</a>
      </div>`;
  }
}

function blogDetailMarkup(blog) {
  const owner = blog.owner || {};
  const mine = state.user && owner.id === state.user.id;
  const images = sortImages(blog.images).map((image) => fixImageUrl(image.image_url));
  const lead = images[0] || "";
  const rest = images.slice(1);

  return `
    <div class="article-head">
      <p class="eyebrow">${formatDate(blog.created_at)} &middot; ${readTime(blog.content)} min read${
    blog.visibility === false ? " &middot; Private" : ""
  }</p>
      <h1 class="article-title">${escapeHtml(blog.title)}</h1>
    </div>

    <div class="article-meta">
      <img class="byline-avatar" src="${escapeAttr(avatarFor(owner))}" alt="" />
      <span class="byline-text">
        <span class="byline-name">${escapeHtml(owner.username || "unknown")}</span>
        <span class="byline-date">${plural(blog.star_count ?? 0, "star", "stars")}</span>
      </span>
      <span class="article-tools">
        ${starButton(blog)}
        ${
          mine
            ? `<a class="btn btn-quiet btn-sm" href="#/edit/${blog.id}">Edit</a>
               <button class="btn btn-alarm btn-sm" data-delete-blog="${blog.id}">Delete</button>`
            : ""
        }
      </span>
    </div>

    ${
      lead
        ? `<figure class="article-lead" data-zoom="0" tabindex="0" role="button" aria-label="Open image 1 full size"><img src="${escapeAttr(
            lead
          )}" alt="${escapeAttr(blog.title)}" /></figure>`
        : ""
    }

    <div class="article-body">${escapeHtml(blog.content || "")}</div>

    ${
      rest.length
        ? `<div class="gallery-head">
             <h2>Images</h2>
             <span class="label-mono">${plural(images.length, "image", "images")}</span>
           </div>
           <div class="gallery">
             ${rest
               .map(
                 (url, i) =>
                   `<div class="gallery-cell" data-zoom="${i + 1}" tabindex="0" role="button"
                      aria-label="Open image ${i + 2} full size">
                      <img src="${escapeAttr(url)}" alt="Image ${i + 2} from ${escapeAttr(
                     blog.title
                   )}" loading="lazy" />
                    </div>`
               )
               .join("")}
           </div>`
        : ""
    }

    <div class="article-foot">
      <a href="#/" class="btn btn-quiet btn-sm">All stories</a>
      <span class="label-mono">${escapeHtml(owner.username || "")}</span>
    </div>`;
}

async function deleteBlog(id) {
  const ok = await confirmAction({
    title: "Delete this story?",
    message: "Its images are deleted from storage too. This cannot be undone.",
    okLabel: "Delete",
  });
  if (!ok) return;

  try {
    await api(`/blogs/${id}`, { method: "DELETE" });
    toast("Story deleted.", "success");
    if ($("#page-profile").classList.contains("active")) {
      renderProfile();
    } else if (location.hash === "#/" || location.hash === "") {
      loadFeed();
    } else {
      location.hash = "#/"; /* hashchange -> route() -> loadFeed() */
    }
  } catch (error) {
    toast(error.message, "error");
  }
}

/* =====================================================================
   FILE DRAG PLUMBING
   ===================================================================== */

function dragHasFiles(event) {
  const types = event.dataTransfer?.types;
  return types ? Array.from(types).includes("Files") : false;
}

const armableZones = new Set();
let windowDragDepth = 0;

function setArmed(on) {
  document.body.classList.toggle("is-dragging-files", on);
  armableZones.forEach((node) => node.classList.toggle("is-armed", on));
}

function disarmAll() {
  windowDragDepth = 0;
  setArmed(false);
  armableZones.forEach((node) => node.classList.remove("is-hot"));
}

function bindWindowDrag() {
  window.addEventListener("dragenter", (event) => {
    if (!dragHasFiles(event)) return;
    windowDragDepth += 1;
    setArmed(true);
  });

  /* Without preventDefault the browser navigates to the dropped file. */
  window.addEventListener("dragover", (event) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
  });

  window.addEventListener("dragleave", (event) => {
    if (!dragHasFiles(event)) return;
    windowDragDepth = Math.max(0, windowDragDepth - 1);
    if (!windowDragDepth) setArmed(false);
  });

  window.addEventListener("drop", (event) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    disarmAll();
  });

  window.addEventListener("dragend", disarmAll);
}

/* dragleave fires every time the pointer crosses into a child element, so a
   naive handler flickers the whole time the file is over the zone. Count the
   crossings instead. */
function bindFileDrop(node, onFiles) {
  let depth = 0;

  node.addEventListener("dragenter", (event) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    depth += 1;
    node.classList.add("is-hot");
  });

  node.addEventListener("dragover", (event) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    node.classList.add("is-hot");
  });

  node.addEventListener("dragleave", (event) => {
    if (!dragHasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) node.classList.remove("is-hot");
  });

  node.addEventListener("drop", (event) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    depth = 0;
    disarmAll();
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) onFiles(files);
  });

  armableZones.add(node);
}

function bindZoneActivation(zone, input) {
  zone.addEventListener("click", (event) => {
    if (event.target === input) return;
    input.click();
  });
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      input.click();
    }
  });
}

function screenImageFiles(files, takenKeys) {
  const accepted = [];
  const problems = [];

  files.forEach((file) => {
    if (!file.type.startsWith("image/")) {
      problems.push(`${file.name} is not an image.`);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      problems.push(`${file.name} is over 10 MB.`);
      return;
    }
    const key = `${file.name}:${file.size}`;
    if (takenKeys.has(key)) {
      problems.push(`${file.name} is already added.`);
      return;
    }
    takenKeys.add(key);
    accepted.push(file);
  });

  return { accepted, problems };
}

/* =====================================================================
   IMAGE BAY — the drag & drop board, shared by write and revise
     mode "deferred"  : files wait on the light table until you publish
     mode "immediate" : files upload the moment they land
   ===================================================================== */

function createImageBay({ mode, blogId, zone, input, grid, countEl, hintEl, onChange }) {
  const items = [];
  const takenKeys = new Set();
  let sequence = 0;
  let dragKey = null;

  function countLabel() {
    if (!items.length) return "None yet";
    const waiting = items.filter((item) => item.kind === "local" && item.status !== "done").length;
    const base = plural(items.length, "image", "images");
    return mode === "deferred" && waiting ? `${base} · upload on publish` : base;
  }

  function paint() {
    countEl.textContent = countLabel();
    if (hintEl) hintEl.hidden = items.length < 2;
    grid.innerHTML = "";

    items.forEach((item, index) => {
      const tile = el("li", `plate-tile is-${item.status}`);
      tile.dataset.key = item.key;
      tile.draggable = true;
      tile.tabIndex = 0;
      tile.setAttribute(
        "aria-label",
        `${item.name}, position ${index + 1} of ${items.length}. ` +
          `Arrow keys reorder, Delete removes.`
      );

      const image = el("img");
      image.src = item.previewUrl;
      image.alt = "";
      tile.appendChild(image);

      if (index === 0) {
        const stamp = el("span", "tile-stamp");
        stamp.textContent = "Cover";
        tile.appendChild(stamp);
      }

      const name = el("span", "tile-name");
      name.textContent = item.name;
      tile.appendChild(name);

      const status = el("span", "tile-state");
      status.textContent =
        item.status === "uploading" ? "Uploading" : item.status === "failed" ? "Failed" : "";
      tile.appendChild(status);

      const drop = el("button", "tile-drop");
      drop.type = "button";
      drop.innerHTML = "&times;";
      drop.setAttribute("aria-label", `Remove ${item.name}`);
      drop.addEventListener("click", (event) => {
        event.stopPropagation();
        remove(item.key);
      });
      tile.appendChild(drop);

      /* reorder by pointer */
      tile.addEventListener("dragstart", (event) => {
        dragKey = item.key;
        tile.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", item.key);
        }
      });
      tile.addEventListener("dragend", () => {
        dragKey = null;
        tile.classList.remove("is-dragging");
        $$(".plate-tile", grid).forEach((node) => node.classList.remove("is-target"));
      });
      tile.addEventListener("dragover", (event) => {
        if (!dragKey || dragKey === item.key) return;
        event.preventDefault();
        event.stopPropagation();
        tile.classList.add("is-target");
      });
      tile.addEventListener("dragleave", () => tile.classList.remove("is-target"));
      tile.addEventListener("drop", (event) => {
        if (!dragKey) return;
        event.preventDefault();
        event.stopPropagation();
        moveTo(dragKey, item.key);
        dragKey = null;
      });

      /* reorder by keyboard */
      tile.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          const target = index + (event.key === "ArrowLeft" ? -1 : 1);
          if (target < 0 || target >= items.length) return;
          items.splice(target, 0, items.splice(index, 1)[0]);
          notify();
          requestAnimationFrame(() => $(`[data-key="${item.key}"]`, grid)?.focus());
        }
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          remove(item.key);
        }
      });

      grid.appendChild(tile);
    });
  }

  function notify() {
    paint();
    if (onChange) onChange(items);
  }

  function moveTo(sourceKey, targetKey) {
    const from = items.findIndex((item) => item.key === sourceKey);
    const to = items.findIndex((item) => item.key === targetKey);
    if (from < 0 || to < 0 || from === to) return;
    items.splice(to, 0, items.splice(from, 1)[0]);
    notify();
  }

  async function remove(key) {
    const index = items.findIndex((item) => item.key === key);
    if (index < 0) return;
    const item = items[index];

    if (item.kind === "remote" && item.imageId) {
      const ok = await confirmAction({
        title: "Remove this image?",
        message: `${item.name} is deleted from storage. This cannot be undone.`,
        okLabel: "Remove",
      });
      if (!ok) return;
      try {
        await api(`/images/${item.imageId}`, { method: "DELETE" });
        toast("Image removed.", "success");
      } catch (error) {
        toast(error.message, "error");
        return;
      }
    }

    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    takenKeys.delete(item.dedupeKey);
    items.splice(index, 1);
    notify();
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const { accepted, problems } = screenImageFiles(files, takenKeys);
    problems.forEach((problem) => toast(problem, "error"));
    if (!accepted.length) return;

    const fresh = accepted.map((file) => {
      const objectUrl = URL.createObjectURL(file);
      return {
        key: `local-${(sequence += 1)}`,
        dedupeKey: `${file.name}:${file.size}`,
        kind: "local",
        file,
        name: file.name,
        previewUrl: objectUrl,
        objectUrl,
        status: "ready",
      };
    });

    items.push(...fresh);
    notify();

    if (mode === "immediate") {
      await uploadItems(fresh);
    } else {
      toast(`${plural(fresh.length, "image", "images")} on the light table.`, "success", 2600);
    }
  }

  /* One request per file. Each POST appends, so the order on screen becomes
     the display_order in the database, and every tile reports its own state. */
  async function uploadItems(targets) {
    const pending = targets.filter((item) => item.kind === "local" && item.status !== "done");
    if (!pending.length) return { uploaded: 0, failed: 0 };
    if (!blogId) return { uploaded: 0, failed: pending.length };

    let uploaded = 0;
    let failed = 0;

    for (const item of pending) {
      item.status = "uploading";
      paint();
      try {
        const form = new FormData();
        form.append("images", item.file, item.name);
        const result = await api(`/blogs/${blogId}/images/upload`, {
          method: "POST",
          body: form,
          form: true,
        });
        const created = Array.isArray(result) ? result[0] : result;

        item.kind = "remote";
        item.imageId = created?.id;
        item.status = "done";
        item.file = null;
        if (created?.image_url) {
          if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
          item.objectUrl = null;
          item.previewUrl = fixImageUrl(created.image_url);
        }
        uploaded += 1;
      } catch (error) {
        item.status = "failed";
        failed += 1;
        toast(`${item.name}: ${error.message}`, "error");
      }
      paint();
    }

    if (onChange) onChange(items);
    return { uploaded, failed };
  }

  function setRemote(images) {
    items.forEach((item) => item.objectUrl && URL.revokeObjectURL(item.objectUrl));
    items.length = 0;
    takenKeys.clear();

    sortImages(images).forEach((image) => {
      const url = fixImageUrl(image.image_url);
      const filename = decodeURIComponent(url.split("/").pop() || "");
      items.push({
        key: `remote-${image.id}`,
        dedupeKey: `remote-${image.id}`,
        kind: "remote",
        imageId: image.id,
        /* stored names are "<uuid>_<original>" — show the readable half */
        name: filename.split("_").slice(1).join("_") || filename || `image-${image.id}`,
        previewUrl: url,
        objectUrl: null,
        status: "done",
      });
      takenKeys.add(`remote-${image.id}`);
    });

    notify();
  }

  function reset() {
    items.forEach((item) => item.objectUrl && URL.revokeObjectURL(item.objectUrl));
    items.length = 0;
    takenKeys.clear();
    notify();
  }

  bindFileDrop(zone, addFiles);
  bindZoneActivation(zone, input);
  input.addEventListener("change", () => {
    addFiles(input.files);
    input.value = "";
  });

  paint();

  return {
    items,
    addFiles,
    reset,
    setRemote,
    uploadItems,
    setBlogId(id) {
      blogId = id;
    },
  };
}

/* =====================================================================
   WRITE
   ===================================================================== */

function renderProof() {
  const body = $("#preview-body");
  const stamp = $("#page-create .proof-stamp");
  const title = $("#create-title").value.trim();
  const content = $("#create-content").value.trim();
  const images = state.createBay ? state.createBay.items : [];

  if (stamp) stamp.textContent = title || content ? "Not printed" : "Empty";

  if (!title && !content) {
    body.innerHTML = `<p class="proof-blank">Type a title to pull a proof.</p>`;
    return;
  }

  body.innerHTML = proofMarkup(title, content, images);
}

function proofMarkup(title, content, images) {
  return `
    <h2>${escapeHtml(title || "Untitled")}</h2>
    <p class="proof-text">${escapeHtml(content || "No text yet.")}</p>
    ${
      images.length
        ? `<div class="proof-strip">${images
            .slice(0, 6)
            .map((item) => `<img src="${escapeAttr(item.previewUrl)}" alt="" />`)
            .join("")}</div>`
        : ""
    }`;
}

async function onCreateBlog(event) {
  event.preventDefault();
  if (!requireAuth("Log in to publish a story.")) return;

  const button = $("#publish-btn");
  const title = $("#create-title").value.trim();
  const content = $("#create-content").value.trim();
  const visibility = $("#create-visibility").checked;

  if (!title) {
    toast("Give the story a title.", "error");
    $("#create-title").focus();
    return;
  }
  if (!content) {
    toast("The story is empty.", "error");
    $("#create-content").focus();
    return;
  }

  setLoading(button, true);

  try {
    /* BlogCreate.thumbnail is Optional[str] with no default, so the key has
       to be present even though the value is null. */
    const blog = await api("/blogs", {
      method: "POST",
      body: { title, content, visibility, thumbnail: null, images: [] },
    });

    const bay = state.createBay;
    const queued = bay ? bay.items.filter((item) => item.kind === "local").length : 0;

    if (queued) {
      bay.setBlogId(blog.id);
      const { uploaded, failed } = await bay.uploadItems([...bay.items]);
      if (failed) {
        toast(`Published. ${uploaded} of ${queued} images uploaded.`, "error", 6500);
      } else {
        toast(`Published with ${plural(uploaded, "image", "images")}.`, "success");
      }
    } else {
      toast("Published.", "success");
    }

    $("#create-form").reset();
    $("#create-title-count").textContent = "0";
    $("#visibility-value").textContent = "Public";
    bay?.reset();
    bay?.setBlogId(null);
    renderProof();
    location.hash = `#/blog/${blog.id}`;
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setLoading(button, false);
  }
}

/* =====================================================================
   REVISE
   ===================================================================== */

async function renderEditPage(id) {
  const body = $("#edit-preview-body");
  body.innerHTML = `<p class="proof-blank">Loading&hellip;</p>`;
  state.editBay.setBlogId(null);
  state.editBay.reset();

  try {
    const blog = await api(`/blogs/${id}`);

    if (!state.user || blog.owner?.id !== state.user.id) {
      toast("That story is not yours to edit.", "error");
      location.hash = `#/blog/${id}`;
      return;
    }

    state.editBlog = blog;
    $("#edit-title").value = blog.title || "";
    $("#edit-content").value = blog.content || "";
    $("#edit-visibility").checked = Boolean(blog.visibility);
    $("#edit-visibility-value").textContent = blog.visibility ? "Public" : "Private";
    $("#edit-cancel").setAttribute("href", `#/blog/${id}`);

    state.editBay.setBlogId(blog.id);
    state.editBay.setRemote(blog.images);
    renderEditProof();
  } catch (error) {
    body.innerHTML = `<p class="proof-blank">${escapeHtml(error.message)}</p>`;
    toast(error.message, "error");
  }
}

function renderEditProof() {
  const images = state.editBay ? state.editBay.items : [];
  $("#edit-preview-body").innerHTML = proofMarkup(
    $("#edit-title").value.trim(),
    $("#edit-content").value.trim(),
    images
  );
}

async function onUpdateBlog(event) {
  event.preventDefault();
  const blog = state.editBlog;
  if (!blog) return;

  const button = $("#update-btn");
  const title = $("#edit-title").value.trim();
  const content = $("#edit-content").value.trim();
  const visibility = $("#edit-visibility").checked;

  if (!title || !content) {
    toast("A story needs both a title and text.", "error");
    return;
  }

  setLoading(button, true);
  try {
    /* BlogUpdate accepts only these three fields. */
    await api(`/blogs/${blog.id}`, {
      method: "PATCH",
      body: { title, content, visibility },
    });
    toast("Changes saved.", "success");
    location.hash = `#/blog/${blog.id}`;
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setLoading(button, false);
  }
}

/* =====================================================================
   YOUR DESK
   ===================================================================== */

/* /users/me/blogs and /users/me/starred have no response_model, so they hand
   back raw rows: no owner, no images, no star counts. Fill in what we know,
   then hydrate each card from GET /blogs/{id}. */
function normalizeOwnBlogs(rows, fallbackOwner) {
  return (rows || []).map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    visibility: row.visibility,
    created_at: row.created_at,
    owner: row.owner || fallbackOwner || { id: row.author_id, username: "unknown" },
    images: row.images || [],
    star_count: row.star_count ?? 0,
    comment_count: row.comment_count ?? 0,
    is_starred: row.is_starred ?? false,
  }));
}

async function hydrateCards(blogs, gridId) {
  const queue = blogs.map((blog, index) => ({ blog, index }));

  const worker = async () => {
    while (queue.length) {
      const { blog, index } = queue.shift();
      try {
        const full = await api(`/blogs/${blog.id}`);
        Object.assign(blog, full);
      } catch {
        continue;
      }
      const grid = document.getElementById(gridId);
      const card = grid ? $(`[data-card="${blog.id}"]`, grid) : null;
      if (!card) continue;
      card.outerHTML = storyCard(blog, index + 1, 0);
      $(`[data-card="${blog.id}"]`, grid)?.classList.add("is-revealed");
    }
  };

  await Promise.all([worker(), worker(), worker()]);
}

async function renderProfile() {
  const user = state.user;
  if (!user) return;

  $("#profile-username").textContent = user.username || "";
  $("#profile-username").dataset.plate = user.username || "";
  $("#profile-email").textContent = user.email || "";
  $("#profile-bio").textContent = user.bio || "No bio yet.";
  $("#profile-joined").textContent = user.created_at
    ? `Member since ${formatDate(user.created_at)}`
    : "Your desk";
  $("#profile-avatar").src = avatarFor(user);
  $("#profile-avatar").alt = user.username ? `${user.username}'s photo` : "";

  $("#edit-username").value = user.username || "";
  $("#edit-bio").value = user.bio || "";
  $("#avatar-drop-img").src = avatarFor(user);
  $("#avatar-clear").hidden = !user.profile_image;

  await Promise.all([loadOwnBlogs(), loadStarredBlogs()]);
}

async function loadOwnBlogs() {
  const grid = $("#my-blogs-grid");
  const empty = $("#my-blogs-empty");
  empty.hidden = true;
  grid.innerHTML = `<div class="sk-card"><span class="sk sk-block"></span><span class="sk sk-line" style="width:82%;height:20px"></span><span class="sk sk-line" style="width:94%"></span></div>`;

  try {
    const rows = await api("/users/me/blogs");
    const blogs = normalizeOwnBlogs(rows, state.user).sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
    state.ownBlogs = blogs;

    if (!blogs.length) {
      grid.innerHTML = "";
      empty.hidden = false;
      return;
    }

    grid.innerHTML = blogs.map((blog, i) => storyCard(blog, i + 1, i)).join("");
    observeReveals(grid);
    hydrateCards(blogs, "my-blogs-grid");
  } catch (error) {
    grid.innerHTML = "";
    empty.hidden = false;
    toast(error.message, "error");
  }
}

async function loadStarredBlogs() {
  const grid = $("#starred-blogs-grid");
  const empty = $("#starred-blogs-empty");
  empty.hidden = true;
  grid.innerHTML = "";

  try {
    const rows = await api("/users/me/starred");
    const seen = new Set();
    const blogs = normalizeOwnBlogs(rows, null)
      .filter((blog) => (seen.has(blog.id) ? false : seen.add(blog.id)))
      .map((blog) => ({ ...blog, is_starred: true, star_count: Math.max(1, blog.star_count) }));
    state.starredBlogs = blogs;

    if (!blogs.length) {
      empty.hidden = false;
      return;
    }

    grid.innerHTML = blogs.map((blog, i) => storyCard(blog, i + 1, i)).join("");
    observeReveals(grid);
    hydrateCards(blogs, "starred-blogs-grid");
  } catch {
    grid.innerHTML = "";
    empty.hidden = false;
  }
}

async function onSaveProfile(event) {
  event.preventDefault();
  const button = $("#save-profile-btn");
  const username = $("#edit-username").value.trim();
  const bio = $("#edit-bio").value.trim();

  if (!username) {
    toast("Pick a username.", "error");
    $("#edit-username").focus();
    return;
  }

  setLoading(button, true);
  try {
    /* Only these two go up — the photo saves on its own the moment it lands,
       so re-sending a data URL on every text edit would be wasted bytes. */
    const updated = await api("/users/me", { method: "PATCH", body: { username, bio } });
    state.user = { ...state.user, ...updated };
    paintAccount();
    toast("Changes saved.", "success");
    closeProfileEditor();
    renderProfile();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setLoading(button, false);
  }
}

/* ------------------------------------------------------- avatar pipeline */

async function loadImageSource(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      try {
        return await createImageBitmap(file);
      } catch {
        /* fall through to <img> */
      }
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    image.src = url;
  });
}

/* Center-crop to a square so faces do not stretch, downscale, encode small.
   The result is a data URL because the API takes profile_image as a string —
   and BlogOwner embeds it in every blog of every list response, so keeping
   it near 160px WebP matters. */
async function squareAvatar(file) {
  const source = await loadImageSource(file);
  const side = Math.min(source.width, source.height);
  const sx = (source.width - side) / 2;
  const sy = (source.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_PX;
  canvas.height = AVATAR_PX;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  if (source.close) source.close();

  let out = canvas.toDataURL("image/webp", 0.75);
  if (!out.startsWith("data:image/webp")) out = canvas.toDataURL("image/jpeg", 0.78);
  return out;
}

async function acceptAvatar(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    toast(`${file.name || "That file"} is not an image.`, "error");
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    toast(`${file.name} is over 10 MB.`, "error");
    return;
  }

  const target = $("#avatar-drop");
  target.classList.add("is-working");

  try {
    const dataUrl = await squareAvatar(file);
    const saved = await api("/users/me", { method: "PATCH", body: { profile_image: dataUrl } });
    state.user = { ...state.user, ...saved };
    applyAvatar(dataUrl);
    $("#avatar-clear").hidden = false;
    toast("Photo updated.", "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    target.classList.remove("is-working");
  }
}

async function clearAvatar() {
  const ok = await confirmAction({
    title: "Remove your photo?",
    message: "Your initial is shown instead. You can add a new photo any time.",
    okLabel: "Remove",
  });
  if (!ok) return;

  try {
    const saved = await api("/users/me", { method: "PATCH", body: { profile_image: null } });
    state.user = { ...state.user, ...saved, profile_image: null };
    applyAvatar(avatarFor(state.user));
    $("#avatar-clear").hidden = true;
    toast("Photo removed.", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

/* Cards already on screen carry the old photo; swap it without a refetch. */
function applyAvatar(src) {
  $("#avatar-drop-img").src = src;
  $("#profile-avatar").src = src;
  paintAccount();

  const id = state.user?.id;
  if (!id) return;

  const pools = [state.ownBlogs, state.starredBlogs, state.feed.blogs || []];
  pools.forEach((pool) =>
    pool.forEach((blog) => {
      if (blog.owner?.id === id) blog.owner.profile_image = state.user.profile_image;
    })
  );

  $$(".story-card").forEach((card) => {
    const blogId = Number(card.dataset.card);
    const match = pools.flat().find((blog) => blog.id === blogId);
    if (match?.owner?.id === id) {
      const image = $(".byline-avatar", card);
      if (image) image.src = src;
    }
  });
}

function openProfileEditor() {
  $("#profile-edit").hidden = false;
  $("#edit-profile-toggle").textContent = "Close";
  $("#edit-username").focus();
}

function closeProfileEditor() {
  $("#profile-edit").hidden = true;
  $("#edit-profile-toggle").textContent = "Edit details";
}

/* =====================================================================
   BINDINGS
   ===================================================================== */

function closeMenu() {
  $("#user-dropdown")?.classList.remove("open");
  $("#user-avatar-btn")?.setAttribute("aria-expanded", "false");
}

function closeTray() {
  $("#mobile-menu")?.classList.remove("open");
  $("#hamburger")?.setAttribute("aria-expanded", "false");
}

function bindMasthead() {
  $("#hamburger").addEventListener("click", () => {
    const open = $("#mobile-menu").classList.toggle("open");
    $("#hamburger").setAttribute("aria-expanded", String(open));
  });

  $("#user-avatar-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    const open = $("#user-dropdown").classList.toggle("open");
    $("#user-avatar-btn").setAttribute("aria-expanded", String(open));
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#user-menu")) closeMenu();
    if (event.target.closest(".tray-link")) closeTray();
  });

  const logout = () => {
    clearSession();
    toast("Logged out.", "success");
    if (location.hash && location.hash !== "#/") {
      location.hash = "#/";
    } else {
      route();
    }
  };
  $("#logout-btn").addEventListener("click", logout);
  $("#mobile-logout-btn").addEventListener("click", logout);

  window.addEventListener(
    "scroll",
    () => {
      $("#masthead").classList.toggle("is-lifted", window.scrollY > 12);
    },
    { passive: true }
  );
}

function bindSearch() {
  const nav = $("#global-search");
  const hero = $("#hero-search-input");

  const run = debounce((value) => {
    state.search = value.trim();
    state.page = 1;
    if ($("#page-feed").classList.contains("active")) {
      loadFeed();
    } else {
      location.hash = "#/"; /* route() loads the feed */
    }
  }, 340);

  const wire = (source, mirror) => {
    source.addEventListener("input", () => {
      if (mirror.value !== source.value) mirror.value = source.value;
      run(source.value);
    });
  };
  wire(nav, hero);
  wire(hero, nav);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    event.preventDefault();
    (window.innerWidth > 1000 ? nav : hero).focus();
  });
}

function bindFeedControls() {
  const toggle = $("#sort-toggle");
  toggle.addEventListener("click", (event) => {
    const button = event.target.closest(".ink-switch-btn");
    if (!button || button.classList.contains("is-on")) return;
    selectSwitch(toggle, button);
    state.sort = button.dataset.sort;
    state.page = 1;
    loadFeed();
  });

  $("#pagination").addEventListener("click", (event) => {
    const button = event.target.closest(".page-btn");
    if (!button || button.disabled) return;
    const page = Number(button.dataset.page);
    if (!page || page === state.page) return;
    state.page = page;
    loadFeed();
    $(".run-bar").scrollIntoView({
      behavior: prefersReduced() ? "auto" : "smooth",
      block: "start",
    });
  });
}

function bindDelegates() {
  document.addEventListener("click", (event) => {
    const star = event.target.closest("[data-star]");
    if (star) {
      event.preventDefault();
      toggleStar(star.dataset.star);
      return;
    }

    const remove = event.target.closest("[data-delete-blog]");
    if (remove) {
      event.preventDefault();
      deleteBlog(remove.dataset.deleteBlog);
      return;
    }

    const zoom = event.target.closest("[data-zoom]");
    if (zoom) openZoom(zoom);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const zoom = event.target.closest?.("[data-zoom]");
    if (!zoom) return;
    event.preventDefault();
    openZoom(zoom);
  });

  /* ink bleed follows the pointer */
  document.addEventListener(
    "pointermove",
    (event) => {
      const button = event.target.closest(".btn");
      if (!button) return;
      const rect = button.getBoundingClientRect();
      button.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      button.style.setProperty("--my", `${event.clientY - rect.top}px`);
    },
    { passive: true }
  );
}

function openZoom(node) {
  if (!state.currentBlog) return;
  const urls = sortImages(state.currentBlog.images).map((image) => fixImageUrl(image.image_url));
  openLightbox(urls, Number(node.dataset.zoom));
}

function bindPasswordToggles() {
  $$(".password-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const input = $("input", button.parentElement);
      if (!input) return;
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      button.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
      $(".eye-open", button).style.display = reveal ? "none" : "";
      $(".eye-closed", button).style.display = reveal ? "" : "none";
    });
  });
}

function bindAuthForms() {
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#login-form button[type=submit]");
    const error = $("#login-error");
    error.textContent = "";

    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    if (!email || !password) {
      error.textContent = "Enter your email and password.";
      return;
    }

    setLoading(button, true);
    try {
      const data = await api("/login", { method: "POST", body: { email, password }, auth: false });
      state.token = data.token;
      localStorage.setItem(TOKEN_KEY, data.token);
      await hydrateAuth();
      $("#login-form").reset();
      toast(`Welcome back, ${state.user?.username || "reader"}.`, "success");
      location.hash = "#/";
      route();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      setLoading(button, false);
    }
  });

  $("#signup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#signup-form button[type=submit]");
    const error = $("#signup-error");
    error.textContent = "";

    const email = $("#signup-email").value.trim();
    const password = $("#signup-password").value;
    if (!email || password.length < 6) {
      error.textContent = "Use a valid email and at least 6 characters.";
      return;
    }

    setLoading(button, true);
    try {
      await api("/signup", { method: "POST", body: { email, password }, auth: false });
      const data = await api("/login", { method: "POST", body: { email, password }, auth: false });
      state.token = data.token;
      localStorage.setItem(TOKEN_KEY, data.token);
      await hydrateAuth();
      $("#signup-form").reset();
      toast("Account created. Write your first story.", "success");
      location.hash = "#/create";
      route();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      setLoading(button, false);
    }
  });
}

function bindComposer() {
  const title = $("#create-title");
  const content = $("#create-content");
  const visibility = $("#create-visibility");

  title.addEventListener("input", () => {
    $("#create-title-count").textContent = String(title.value.length);
    renderProof();
  });
  content.addEventListener("input", debounce(renderProof, 140));
  visibility.addEventListener("change", () => {
    $("#visibility-value").textContent = visibility.checked ? "Public" : "Private";
  });

  state.createBay = createImageBay({
    mode: "deferred",
    blogId: null,
    zone: $("#create-dropzone"),
    input: $("#create-image-input"),
    grid: $("#create-image-grid"),
    countEl: $("#create-image-count"),
    hintEl: $("#create-reorder-hint"),
    onChange: renderProof,
  });

  $("#create-form").addEventListener("submit", onCreateBlog);
}

function bindEditor() {
  const visibility = $("#edit-visibility");

  $("#edit-title").addEventListener("input", debounce(renderEditProof, 140));
  $("#edit-content").addEventListener("input", debounce(renderEditProof, 140));
  visibility.addEventListener("change", () => {
    $("#edit-visibility-value").textContent = visibility.checked ? "Public" : "Private";
  });

  state.editBay = createImageBay({
    mode: "immediate",
    blogId: null,
    zone: $("#edit-dropzone"),
    input: $("#edit-image-input"),
    grid: $("#edit-image-grid"),
    countEl: $("#edit-image-count"),
    hintEl: null,
    onChange: renderEditProof,
  });

  $("#edit-form").addEventListener("submit", onUpdateBlog);
}

function bindProfile() {
  $("#edit-profile-toggle").addEventListener("click", () => {
    if ($("#profile-edit").hidden) openProfileEditor();
    else closeProfileEditor();
  });

  $("#cancel-edit-profile").addEventListener("click", () => {
    closeProfileEditor();
    $("#edit-username").value = state.user?.username || "";
    $("#edit-bio").value = state.user?.bio || "";
  });

  $("#profile-edit-form").addEventListener("submit", onSaveProfile);

  const tabs = $("#profile-tabs");
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest(".ink-switch-btn");
    if (!button || button.classList.contains("is-on")) return;
    selectSwitch(tabs, button);
    state.profileTab = button.dataset.tab;
    $("#tab-my-blogs").hidden = state.profileTab !== "my-blogs";
    $("#tab-starred-blogs").hidden = state.profileTab !== "starred-blogs";
  });

  /* avatar: drop a file, click to browse, or paste from the clipboard */
  const target = $("#avatar-drop");
  const input = $("#avatar-input");

  bindFileDrop(target, (files) => acceptAvatar(files[0]));
  bindZoneActivation(target, input);
  input.addEventListener("change", () => {
    acceptAvatar(input.files?.[0]);
    input.value = "";
  });

  document.addEventListener("paste", (event) => {
    if (!$("#page-profile").classList.contains("active")) return;
    if ($("#profile-edit").hidden) return;
    const item = Array.from(event.clipboardData?.items || []).find((entry) =>
      entry.type.startsWith("image/")
    );
    if (!item) return;
    event.preventDefault();
    acceptAvatar(item.getAsFile());
  });

  $("#avatar-clear").addEventListener("click", clearAvatar);
}

function bindOverlays() {
  $("#confirm-cancel").addEventListener("click", () => closeConfirm(false));
  $("#confirm-ok").addEventListener("click", () => closeConfirm(true));
  $("#confirm-modal").addEventListener("click", (event) => {
    if (event.target === $("#confirm-modal")) closeConfirm(false);
  });

  $("#lightbox-close").addEventListener("click", closeLightbox);
  $("#lightbox-prev").addEventListener("click", () => stepLightbox(-1));
  $("#lightbox-next").addEventListener("click", () => stepLightbox(1));
  $("#lightbox").addEventListener("click", (event) => {
    if (event.target === $("#lightbox")) closeLightbox();
  });

  document.addEventListener("keydown", (event) => {
    const confirmOpen = !$("#confirm-modal").hidden;
    const lightboxOpen = !$("#lightbox").hidden;

    if (event.key === "Escape") {
      if (confirmOpen) return closeConfirm(false);
      if (lightboxOpen) return closeLightbox();
      closeMenu();
      closeTray();
      return;
    }
    if (event.key === "Tab" && confirmOpen) {
      trapFocus($(".dialog", $("#confirm-modal")), event);
      return;
    }
    if (lightboxOpen) {
      if (event.key === "ArrowLeft") stepLightbox(-1);
      if (event.key === "ArrowRight") stepLightbox(1);
    }
  });
}

/* ------------------------------------------------------------------ init */

async function init() {
  if (!document.startViewTransition) document.body.classList.add("no-vt");

  bindWindowDrag();
  bindMasthead();
  bindSearch();
  bindFeedControls();
  bindDelegates();
  bindPasswordToggles();
  bindAuthForms();
  bindComposer();
  bindEditor();
  bindProfile();
  bindOverlays();

  window.addEventListener("hashchange", route);
  window.addEventListener(
    "resize",
    debounce(() => $$(".ink-switch").forEach(positionSwitch), 120)
  );

  await hydrateAuth();
  route();

  $$(".ink-switch").forEach(positionSwitch);
  /* web fonts change button widths, so re-measure the sliders once loaded */
  document.fonts?.ready.then(() => $$(".ink-switch").forEach(positionSwitch));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
