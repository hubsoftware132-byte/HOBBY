/* ============================================================
   INVENTORY MONITORING SYSTEM — script.js
   Pure Vanilla JavaScript | Firebase Realtime DB | Cloudinary
   ============================================================ */

"use strict";

// ─────────────────────────────────────────────────────────────
// APP STATE
// ─────────────────────────────────────────────────────────────
const AppState = {
  currentUser: null,
  products: {},
  adjustments: {},
  logs: {},
  categories: [],
  currentSection: "dashboard",
  listenersInitialized: false,
  hasShownDataModeToast: false,
  // Pagination state per module
  masterPage: 1, masterPerPage: 15, masterFilter: "", masterCatFilter: "",
  invPage: 1, invPerPage: 15, invFilter: "", invCatFilter: "", invSort: "code",
  adjPage: 1, adjPerPage: 15, adjFilter: "", adjDateFrom: "", adjDateTo: "",
  logPage: 1, logPerPage: 20, logFilter: "", logAction: "", logDateFrom: "", logDateTo: "",
  editingProductId: null,
  pendingPhotoUrl: null,
  pendingPhotoPublicId: null,
};

// ─────────────────────────────────────────────────────────────
// HELPERS & UTILITIES
// ─────────────────────────────────────────────────────────────

/** Generate a human-readable reference number */
function genRef(prefix) {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${prefix}-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${Math.floor(Math.random()*9000)+1000}`;
}

/** Format currency */
function fmt(n) { return "₱" + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 }); }

/** Format number */
function fmtNum(n) { return Number(n || 0).toLocaleString("en-PH"); }

/** Format date string */
function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

/** Format datetime string */
function fmtDT(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Get computed QOH for a product from adjustments */
function getQOH(productId) {
  let qty = 0;
  Object.values(AppState.adjustments).forEach(a => {
    if (a.productId === productId) {
      qty += a.type === "ADD" ? Number(a.quantity) : -Number(a.quantity);
    }
  });
  return qty;
}

/** Sanitize text for HTML */
function esc(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

/** DOM helper */
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

/** Debounce */
function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function isConfiguredValue(value) {
  return typeof value === "string" && value.trim() !== "" && !value.startsWith("YOUR_");
}

function getDataMode() {
  return window.APP_DATA_MODE === "firebase" ? "firebase" : "local";
}

function isCloudinaryReady() {
  return isConfiguredValue(CLOUDINARY_CLOUD_NAME) && isConfiguredValue(CLOUDINARY_UPLOAD_PRESET);
}

function isAdmin() {
  return AppState.currentUser?.role === "Admin";
}

function getReorderPoint(product) {
  const value = Number(product?.reorderPoint);
  return Number.isFinite(value) && value >= 0 ? value : 10;
}

function dateInputToTimestamp(dateString) {
  const [year, month, day] = String(dateString || "").split("-").map(Number);
  if (!year || !month || !day) return Date.now();
  const now = new Date();
  return new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()).getTime();
}

function hideLoadingOverlay() {
  const overlay = $("loading-overlay");
  if (!overlay) return;
  overlay.style.opacity = "0";
  overlay.style.pointerEvents = "none";
  setTimeout(() => overlay.remove(), 180);
}

function updateDataModeBadge() {
  const badge = $("data-mode-badge");
  if (!badge) return;
  if (getDataMode() !== "local") {
    badge.hidden = true;
    badge.textContent = "";
    badge.removeAttribute("data-mode");
    return;
  }
  badge.hidden = false;
  badge.dataset.mode = "local";
  badge.textContent = "Local Demo Data";
  badge.title = window.APP_DATA_MESSAGE || "Using local demo data on this device.";
}

function applyRolePermissions() {
  const admin = isAdmin();
  $$("[data-admin-only]").forEach(el => {
    el.hidden = !admin;
  });
}

function ensureAdminAccess(actionLabel) {
  if (isAdmin()) return true;
  showToast(`Only administrators can ${actionLabel}.`, "warning");
  return false;
}

/** Stock status */
function stockStatus(qty, reorderPoint = 10) {
  if (qty <= 0) return { label: "Out of Stock", cls: "badge-red" };
  if (qty <= reorderPoint) return { label: "Low Stock", cls: "badge-yellow" };
  return { label: "In Stock", cls: "badge-green" };
}

// ─────────────────────────────────────────────────────────────
// TOAST NOTIFICATIONS
// ─────────────────────────────────────────────────────────────
function showToast(msg, type = "success") {
  const icons = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
  };
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = `<div class="toast-icon">${icons[type]}</div><span>${esc(msg)}</span>`;
  $("toast-container").appendChild(t);
  setTimeout(() => { t.style.animation = "fadeOut 0.3s ease forwards"; setTimeout(() => t.remove(), 300); }, 3500);
}

// ─────────────────────────────────────────────────────────────
// CONFIRM DIALOG
// ─────────────────────────────────────────────────────────────
function showConfirm(title, msg, onConfirm) {
  $("confirm-title").textContent = title;
  $("confirm-msg").textContent = msg;
  $("confirm-overlay").classList.add("open");
  $("confirm-ok").onclick = () => { $("confirm-overlay").classList.remove("open"); onConfirm(); };
}

// ─────────────────────────────────────────────────────────────
// LOGIN / LOGOUT
// ─────────────────────────────────────────────────────────────
const DEMO_USERS = [
  { username: "admin", password: "admin123", role: "Admin" },
  { username: "staff", password: "staff123", role: "Staff" }
];

function initLogin() {
  let savedUser = null;
  try {
    savedUser = JSON.parse(localStorage.getItem("ims_user") || "null");
  } catch (err) {
    console.warn("IMS saved user reset after parse failure.", err);
    localStorage.removeItem("ims_user");
  }
  if (savedUser?.username && savedUser?.role) {
    AppState.currentUser = savedUser;
    showApp();
    return;
  }
  $("login-screen").style.display = "flex";
  $("login-form").addEventListener("submit", handleLogin);
  hideLoadingOverlay();
}

function handleLogin(e) {
  e.preventDefault();
  const username = $("login-username").value.trim().toLowerCase();
  const password = $("login-password").value;
  const user = DEMO_USERS.find(u => u.username === username && u.password === password);
  if (!user) { $("login-error").style.display = "block"; return; }
  $("login-error").style.display = "none";
  AppState.currentUser = { username: user.username, role: user.role };
  localStorage.setItem("ims_user", JSON.stringify(AppState.currentUser));
  showApp();
}

function showApp() {
  $("login-screen").style.display = "none";
  $("app").style.display = "flex";
  $("sidebar-username").textContent = AppState.currentUser.username;
  $("sidebar-role").textContent = AppState.currentUser.role;
  $("sidebar-avatar").textContent = AppState.currentUser.username[0].toUpperCase();
  applyRolePermissions();
  updateDataModeBadge();
  initFirebaseListeners();
  if (getDataMode() === "local" && !AppState.hasShownDataModeToast) {
    showToast(window.APP_DATA_MESSAGE || "Using local demo data on this device.", "warning");
    AppState.hasShownDataModeToast = true;
  }
  hideLoadingOverlay();
}

function logout() {
  localStorage.removeItem("ims_user");
  AppState.currentUser = null;
  location.reload();
}

// ─────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────
function navigate(section) {
  if (section === "categories" && !isAdmin()) {
    showToast("Only administrators can access categories.", "warning");
    return;
  }
  AppState.currentSection = section;
  // Update nav items
  $$(".nav-item").forEach(el => {
    el.classList.toggle("active", el.dataset.section === section);
  });
  // Show/hide sections
  $$(".section").forEach(el => {
    el.classList.toggle("active", el.id === "section-" + section);
  });
  // Update topbar title
  const titles = {
    dashboard: "Dashboard",
    masterfile: "Item Masterfile",
    inventory: "Inventory",
    adjustments: "Adjustments",
    logs: "Monitoring Logs",
    categories: "Categories",
    reports: "Reports"
  };
  $("topbar-title").textContent = titles[section] || section;
  // Close sidebar on mobile
  if (window.innerWidth <= 900) $("sidebar").classList.remove("open");
  // Refresh module
  if (section === "dashboard") renderDashboard();
  if (section === "masterfile") renderMasterfile();
  if (section === "inventory") renderInventory();
  if (section === "adjustments") renderAdjustments();
  if (section === "logs") renderLogs();
  if (section === "categories") renderCategories();
}

// ─────────────────────────────────────────────────────────────
// FIREBASE REAL-TIME LISTENERS
// ─────────────────────────────────────────────────────────────
function initFirebaseListeners() {
  if (AppState.listenersInitialized) return;
  AppState.listenersInitialized = true;
  // Products
  dbRefs.products.on("value", snap => {
    AppState.products = snap.val() || {};
    refreshCurrentSection();
  });
  // Adjustments
  dbRefs.adjustments.on("value", snap => {
    AppState.adjustments = snap.val() || {};
    refreshCurrentSection();
  });
  // Logs
  dbRefs.logs.on("value", snap => {
    AppState.logs = snap.val() || {};
    refreshCurrentSection();
  });
  // Categories
  dbRefs.categories.on("value", snap => {
    AppState.categories = snap.val() ? Object.values(snap.val()) : [];
    refreshCurrentSection();
  });
}

function refreshCurrentSection() {
  const s = AppState.currentSection;
  if (s === "dashboard") renderDashboard();
  if (s === "masterfile") renderMasterfile();
  if (s === "inventory") renderInventory();
  if (s === "adjustments") renderAdjustments();
  if (s === "logs") renderLogs();
  if (s === "categories") renderCategories();
}

// ─────────────────────────────────────────────────────────────
// LOG HELPER — writes a movement log to Firebase
// ─────────────────────────────────────────────────────────────
async function writeLog({ productId, productCode, productName, action, refNo, prevQty, adjQty, newQty, remarks }) {
  const logEntry = {
    timestamp: Date.now(),
    productId: productId || "",
    productCode: productCode || "",
    productName: productName || "",
    action,
    refNo: refNo || "",
    prevQty: prevQty != null ? prevQty : "",
    adjQty: adjQty != null ? adjQty : "",
    newQty: newQty != null ? newQty : "",
    remarks: remarks || "",
    performedBy: AppState.currentUser?.username || "system"
  };
  await dbRefs.logs.push(logEntry);
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD MODULE
// ─────────────────────────────────────────────────────────────
function renderDashboard() {
  const products = Object.entries(AppState.products);
  const cats = new Set(products.map(([,p]) => p.category).filter(Boolean));
  let totalQOH = 0, totalValue = 0, lowStock = [];

  products.forEach(([id, p]) => {
    const qty = getQOH(id);
    totalQOH += qty;
    totalValue += qty * Number(p.unitCost || 0);
    if (qty <= getReorderPoint(p)) lowStock.push({ ...p, id, qty });
  });

  $("dash-total-products").textContent = fmtNum(products.length);
  $("dash-total-cats").textContent = fmtNum(cats.size);
  $("dash-total-qoh").textContent = fmtNum(totalQOH);
  $("dash-total-value").textContent = fmt(totalValue);

  // Recent adjustments count
  const adjCount = Object.keys(AppState.adjustments).length;
  $("dash-adj-count").textContent = fmtNum(adjCount);

  // Recent logs
  const logs = Object.entries(AppState.logs)
    .map(([id, l]) => ({ ...l, id }))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 8);

  const logList = $("dash-recent-logs");
  if (!logs.length) {
    logList.innerHTML = `<div class="empty-state"><p>No activity yet.</p></div>`;
  } else {
    logList.innerHTML = logs.map(l => `
      <div class="log-item">
        <div class="log-dot"></div>
        <div class="log-main">
          <div><strong>${esc(l.action)}</strong> — ${esc(l.productName || "N/A")}</div>
          <div class="log-time">${fmtDT(l.timestamp)} · by ${esc(l.performedBy)}</div>
        </div>
      </div>
    `).join("");
  }

  // Low stock items
  const lowList = $("dash-low-stock");
  const lowItems = lowStock.sort((a, b) => a.qty - b.qty).slice(0, 6);
  if (!lowItems.length) {
    lowList.innerHTML = `<div class="empty-state"><p>No low stock items. 🎉</p></div>`;
  } else {
    lowList.innerHTML = lowItems.map(p => {
      const s = stockStatus(p.qty, getReorderPoint(p));
      return `<div class="low-stock-item">
        <span>${esc(p.productName)}</span>
        <span class="badge ${s.cls}">${s.label} (${p.qty})</span>
      </div>`;
    }).join("");
  }
}

// ─────────────────────────────────────────────────────────────
// ITEM MASTERFILE MODULE
// ─────────────────────────────────────────────────────────────
function renderMasterfile() {
  const search = AppState.masterFilter.toLowerCase();
  const catF = AppState.masterCatFilter;
  let products = Object.entries(AppState.products)
    .map(([id, p]) => ({ ...p, id }))
    .filter(p => {
      const matchSearch = !search ||
        p.productCode?.toLowerCase().includes(search) ||
        p.productName?.toLowerCase().includes(search) ||
        p.serialNo?.toLowerCase().includes(search);
      const matchCat = !catF || p.category === catF;
      return matchSearch && matchCat;
    })
    .sort((a, b) => (a.productCode || "").localeCompare(b.productCode || ""));

  const total = products.length;
  const perPage = AppState.masterPerPage;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (AppState.masterPage > totalPages) AppState.masterPage = 1;
  const page = products.slice((AppState.masterPage - 1) * perPage, AppState.masterPage * perPage);

  const tbody = $("master-tbody");
  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
      <h3>No products found</h3><p>Add your first product to get started.</p>
    </div></td></tr>`;
  } else {
    tbody.innerHTML = page.map(p => {
      const photoHtml = p.photoUrl
        ? `<img src="${esc(p.photoUrl)}" class="product-thumb" alt="photo" loading="lazy">`
        : `<div class="no-photo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`;
      const actionsHtml = isAdmin()
        ? `<div class="row-actions">
            <button class="btn btn-sm btn-secondary btn-icon" onclick="viewProduct('${p.id}')" title="View">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="btn btn-sm btn-secondary btn-icon" onclick="openEditProduct('${p.id}')" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn btn-sm btn-danger btn-icon" onclick="deleteProduct('${p.id}')" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </div>`
        : `<div class="row-actions">
            <button class="btn btn-sm btn-secondary btn-icon" onclick="viewProduct('${p.id}')" title="View">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>`;
      return `<tr>
        <td>${photoHtml}</td>
        <td><span class="code-chip">${esc(p.productCode)}</span></td>
        <td><strong>${esc(p.productName)}</strong></td>
        <td>${esc(p.serialNo || "—")}</td>
        <td><span class="badge badge-blue">${esc(p.category || "—")}</span></td>
        <td>${fmt(p.unitCost)}</td>
        <td>${fmt(p.unitPrice)}</td>
        <td>${fmtDate(p.dateCreated)}</td>
        <td>
          ${actionsHtml}
        </td>
      </tr>`;
    }).join("");
  }

  renderPagination("master", total, AppState.masterPage, perPage);
  populateCategoryFilter("master-cat-filter", AppState.masterCatFilter);
}

function filterMasterfile() {
  AppState.masterFilter = $("master-search").value;
  AppState.masterPage = 1;
  renderMasterfile();
}

// ── Product Form (Add / Edit) ──────────────────────────────
function clearPendingPhoto() {
  AppState.pendingPhotoUrl = null;
  AppState.pendingPhotoPublicId = null;
  $("photo-file-input").value = "";
  $("product-photo-preview").removeAttribute("src");
  $("product-photo-preview").style.display = "none";
  $("product-upload-area").style.display = "flex";
  $("photo-upload-progress").style.display = "none";
  $("photo-upload-progress").textContent = "";
  $("change-photo-btn").style.display = "none";
}

function setPhotoPreview(src) {
  $("product-photo-preview").src = src;
  $("product-photo-preview").style.display = "block";
  $("product-upload-area").style.display = "none";
  $("change-photo-btn").style.display = "inline-flex";
}

function openAddProduct() {
  if (!ensureAdminAccess("add products")) return;
  AppState.editingProductId = null;
  resetProductForm();
  $("product-modal-title").textContent = "Add New Product";
  openModal("product-modal");
}

function openEditProduct(id) {
  if (!ensureAdminAccess("edit products")) return;
  const p = AppState.products[id];
  if (!p) return;
  AppState.editingProductId = id;
  resetProductForm();
  AppState.pendingPhotoUrl = p.photoUrl || null;
  $("product-modal-title").textContent = "Edit Product";
  $("pf-code").value = p.productCode || "";
  $("pf-name").value = p.productName || "";
  $("pf-serial").value = p.serialNo || "";
  $("pf-desc").value = p.description || "";
  $("pf-category").value = p.category || "";
  $("pf-cost").value = p.unitCost || "";
  $("pf-price").value = p.unitPrice || "";
  $("pf-reorder").value = Number.isFinite(Number(p.reorderPoint)) ? p.reorderPoint : "";
  if (p.photoUrl) {
    setPhotoPreview(p.photoUrl);
  }
  openModal("product-modal");
}

function resetProductForm() {
  ["pf-code", "pf-name", "pf-serial", "pf-desc", "pf-category", "pf-cost", "pf-price", "pf-reorder"].forEach(id => {
    $(id).value = "";
  });
  ["pf-code", "pf-name", "pf-category", "pf-cost", "pf-price", "pf-reorder"].forEach(id => {
    $(id).classList.remove("error");
  });
  ["pf-code-err", "pf-name-err", "pf-cat-err", "pf-cost-err", "pf-price-err"].forEach(id => {
    $(id).classList.remove("show");
  });
  $("pf-code-err").textContent = "Product Code is required.";
  $("pf-name-err").textContent = "Product Name is required.";
  $("pf-cat-err").textContent = "Category is required.";
  $("pf-cost-err").textContent = "Valid unit cost is required.";
  $("pf-price-err").textContent = "Valid unit price is required.";
  clearPendingPhoto();
}

async function saveProduct() {
  if (!ensureAdminAccess("save products")) return;

  let valid = true;
  const required = [
    { id: "pf-code", errId: "pf-code-err", numeric: false },
    { id: "pf-name", errId: "pf-name-err", numeric: false },
    { id: "pf-category", errId: "pf-cat-err", numeric: false },
    { id: "pf-cost", errId: "pf-cost-err", numeric: true },
    { id: "pf-price", errId: "pf-price-err", numeric: true },
  ];
  required.forEach(field => {
    const value = $(field.id).value.trim();
    const numberValue = Number(value);
    const bad = !value || (field.numeric && (!Number.isFinite(numberValue) || numberValue < 0));
    $(field.id).classList.toggle("error", bad);
    $(field.errId).classList.toggle("show", bad);
    if (bad) valid = false;
  });

  const reorderRaw = $("pf-reorder").value.trim();
  const reorderPoint = reorderRaw === "" ? null : Number(reorderRaw);
  const reorderBad = reorderRaw !== "" && (!Number.isFinite(reorderPoint) || reorderPoint < 0);
  $("pf-reorder").classList.toggle("error", reorderBad);
  if (reorderBad) {
    showToast("Reorder point must be zero or greater.", "warning");
    valid = false;
  }

  if (!valid) return;

  const code = $("pf-code").value.trim().toUpperCase();

  // Duplicate code check
  const dupEntry = Object.entries(AppState.products).find(([id, p]) =>
    p.productCode === code && id !== AppState.editingProductId
  );
  if (dupEntry) {
    $("pf-code").classList.add("error");
    $("pf-code-err").textContent = "Product Code already exists.";
    $("pf-code-err").classList.add("show");
    return;
  }

  const data = {
    productCode: code,
    productName: $("pf-name").value.trim(),
    serialNo: $("pf-serial").value.trim(),
    description: $("pf-desc").value.trim(),
    category: $("pf-category").value.trim(),
    unitCost: Number($("pf-cost").value),
    unitPrice: Number($("pf-price").value),
    reorderPoint,
    photoUrl: AppState.pendingPhotoUrl || null,
    lastUpdated: Date.now()
  };

  const btn = $("save-product-btn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    if (AppState.editingProductId) {
      // Edit
      await dbRefs.products.child(AppState.editingProductId).update(data);
      await writeLog({
        productId: AppState.editingProductId,
        productCode: data.productCode,
        productName: data.productName,
        action: "Product Updated",
        refNo: "",
        remarks: `Updated by ${AppState.currentUser.username}`
      });
      showToast("Product updated successfully!", "success");
    } else {
      // Add
      data.dateCreated = Date.now();
      const ref = await dbRefs.products.push(data);
      await writeLog({
        productId: ref.key,
        productCode: data.productCode,
        productName: data.productName,
        action: "Product Added",
        refNo: "",
        remarks: `Added by ${AppState.currentUser.username}`
      });
      showToast("Product added successfully!", "success");
    }
    closeModal("product-modal");
    renderMasterfile();
  } catch (err) {
    showToast("Error saving product: " + err.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Save Product";
  }
}

function viewProduct(id) {
  const p = AppState.products[id];
  if (!p) return;
  const qty = getQOH(id);
  const s = stockStatus(qty, getReorderPoint(p));
  const imgHtml = p.photoUrl
    ? `<img src="${esc(p.photoUrl)}" class="product-detail-img" alt="photo">`
    : `<div style="height:120px;background:var(--bg-hover);border-radius:var(--radius);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;color:var(--text-muted);margin-bottom:16px;">No Photo</div>`;

  $("view-product-body").innerHTML = `
    ${imgHtml}
    <div class="detail-grid">
      <div class="detail-item"><label>Product Code</label><span class="code-chip">${esc(p.productCode)}</span></div>
      <div class="detail-item"><label>Serial No.</label><span>${esc(p.serialNo || "—")}</span></div>
      <div class="detail-item full"><label>Product Name</label><span style="font-size:16px;font-weight:700">${esc(p.productName)}</span></div>
      <div class="detail-item"><label>Category</label><span><span class="badge badge-blue">${esc(p.category || "—")}</span></span></div>
      <div class="detail-item"><label>Status</label><span><span class="badge ${s.cls}">${s.label}</span></span></div>
      <div class="detail-item"><label>Unit Cost</label><span>${fmt(p.unitCost)}</span></div>
      <div class="detail-item"><label>Unit Price</label><span>${fmt(p.unitPrice)}</span></div>
      <div class="detail-item"><label>Reorder Point</label><span>${fmtNum(getReorderPoint(p))}</span></div>
      <div class="detail-item"><label>Qty On Hand</label><span class="mono" style="font-size:18px;font-weight:700">${fmtNum(qty)}</span></div>
      <div class="detail-item"><label>Inventory Value</label><span>${fmt(qty * Number(p.unitCost || 0))}</span></div>
      <div class="detail-item full"><label>Description</label><span>${esc(p.description || "—")}</span></div>
      <div class="detail-item"><label>Date Created</label><span>${fmtDate(p.dateCreated)}</span></div>
      <div class="detail-item"><label>Last Updated</label><span>${fmtDate(p.lastUpdated)}</span></div>
    </div>
  `;
  openModal("view-product-modal");
}

async function deleteProduct(id) {
  if (!ensureAdminAccess("delete products")) return;
  const p = AppState.products[id];
  if (!p) return;
  showConfirm(
    "Delete Product",
    `Are you sure you want to delete "${p.productName}"? This action cannot be undone.`,
    async () => {
      try {
        await dbRefs.products.child(id).remove();
        await writeLog({
          productId: id,
          productCode: p.productCode,
          productName: p.productName,
          action: "Product Deleted",
          remarks: `Deleted by ${AppState.currentUser.username}`
        });
        showToast("Product deleted.", "warning");
        renderMasterfile();
      } catch (err) {
        showToast("Error deleting product: " + err.message, "error");
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────
// CLOUDINARY PHOTO UPLOAD
// ─────────────────────────────────────────────────────────────
async function uploadToCloudinary(file) {
  // Validate type and size
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    showToast("Invalid file type. Please upload JPG, PNG, or WebP.", "error");
    return null;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast("File too large. Max 5MB allowed.", "error");
    return null;
  }

  const progressEl = $("photo-upload-progress");
  progressEl.style.display = "block";
  progressEl.textContent = "Uploading…";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", "inventory-system");

  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
      method: "POST",
      body: formData
    });
    const data = await res.json();
    if (data.secure_url) {
      progressEl.textContent = "Upload complete!";
      return { url: data.secure_url, publicId: data.public_id };
    } else {
      throw new Error(data.error?.message || "Upload failed");
    }
  } catch (err) {
    progressEl.textContent = "Upload failed.";
    showToast("Photo upload failed: " + err.message, "error");
    return null;
  }
}

function initPhotoUpload() {
  const fileInput = $("photo-file-input");
  const area = $("product-upload-area");
  const preview = $("product-photo-preview");
  if (!fileInput || !area || !preview) return;

  area.addEventListener("click", () => fileInput.click());
  area.addEventListener("dragover", e => { e.preventDefault(); area.classList.add("drag-over"); });
  area.addEventListener("dragleave", () => area.classList.remove("drag-over"));
  area.addEventListener("drop", e => {
    e.preventDefault(); area.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) handlePhotoFile(file);
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) handlePhotoFile(file);
  });

  async function handlePhotoFile(file) {
    const previewUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error("Unable to read the selected photo."));
      reader.readAsDataURL(file);
    }).catch(err => {
      showToast(err.message, "error");
      return null;
    });

    if (!previewUrl) return;

    setPhotoPreview(previewUrl);
    const progressEl = $("photo-upload-progress");
    progressEl.style.display = "block";

    if (!isCloudinaryReady()) {
      AppState.pendingPhotoUrl = previewUrl;
      AppState.pendingPhotoPublicId = null;
      progressEl.textContent = getDataMode() === "local"
        ? "Photo stored in local demo data."
        : "Cloudinary is not configured. Photo will be embedded in the product record.";
      return;
    }

    const result = await uploadToCloudinary(file);
    if (result) {
      AppState.pendingPhotoUrl = result.url;
      AppState.pendingPhotoPublicId = result.publicId;
      progressEl.textContent = "Upload complete!";
      return;
    }

    clearPendingPhoto();
  }
}

// ─────────────────────────────────────────────────────────────
// INVENTORY MODULE
// ─────────────────────────────────────────────────────────────
function renderInventory() {
  const search = AppState.invFilter.toLowerCase();
  const catF = AppState.invCatFilter;
  let products = Object.entries(AppState.products)
    .map(([id, p]) => ({ ...p, id, qty: getQOH(id) }))
    .filter(p => {
      const matchSearch = !search ||
        p.productCode?.toLowerCase().includes(search) ||
        p.productName?.toLowerCase().includes(search);
      const matchCat = !catF || p.category === catF;
      return matchSearch && matchCat;
    });

  // Sort
  products.sort((a, b) => {
    const s = AppState.invSort;
    if (s === "name") return (a.productName || "").localeCompare(b.productName || "");
    if (s === "qty-asc") return a.qty - b.qty;
    if (s === "qty-desc") return b.qty - a.qty;
    return (a.productCode || "").localeCompare(b.productCode || "");
  });

  const total = products.length;
  const perPage = AppState.invPerPage;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (AppState.invPage > totalPages) AppState.invPage = 1;
  const page = products.slice((AppState.invPage - 1) * perPage, AppState.invPage * perPage);

  const tbody = $("inv-tbody");
  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
      <h3>No inventory items</h3><p>Add products in the Item Masterfile first.</p>
    </div></td></tr>`;
  } else {
    tbody.innerHTML = page.map(p => {
      const reorderPoint = getReorderPoint(p);
      const s = stockStatus(p.qty, reorderPoint);
      const value = p.qty * Number(p.unitCost || 0);
      const photoHtml = p.photoUrl
        ? `<img src="${esc(p.photoUrl)}" class="product-thumb" alt="photo" loading="lazy">`
        : `<div class="no-photo"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg></div>`;
      const rowStyle = p.qty <= 0 ? ' style="opacity:0.7"' : (p.qty <= reorderPoint ? ' style="background: rgba(245,158,11,0.04)"' : '');
      return `<tr${rowStyle}>
        <td>${photoHtml}</td>
        <td><span class="code-chip">${esc(p.productCode)}</span></td>
        <td><strong>${esc(p.productName)}</strong></td>
        <td>${esc(p.serialNo || "—")}</td>
        <td><span class="badge badge-blue">${esc(p.category || "—")}</span></td>
        <td>${fmt(p.unitCost)}</td>
        <td>${fmt(p.unitPrice)}</td>
        <td class="mono" style="font-weight:600;font-size:15px">${fmtNum(p.qty)}</td>
        <td>${fmt(value)}</td>
        <td><span class="badge ${s.cls}">${s.label}</span></td>
      </tr>`;
    }).join("");
  }

  renderPagination("inv", total, AppState.invPage, perPage);
  populateCategoryFilter("inv-cat-filter", AppState.invCatFilter);
}

// ─────────────────────────────────────────────────────────────
// ADJUSTMENT MODULE
// ─────────────────────────────────────────────────────────────
function renderAdjustments() {
  const search = AppState.adjFilter.toLowerCase();
  const dateFrom = AppState.adjDateFrom ? new Date(AppState.adjDateFrom).getTime() : null;
  const dateTo = AppState.adjDateTo ? new Date(AppState.adjDateTo + "T23:59:59").getTime() : null;

  let adjs = Object.entries(AppState.adjustments)
    .map(([id, a]) => ({ ...a, id }))
    .filter(a => {
      const matchSearch = !search ||
        a.refNo?.toLowerCase().includes(search) ||
        a.productCode?.toLowerCase().includes(search) ||
        a.productName?.toLowerCase().includes(search);
      const matchFrom = !dateFrom || a.timestamp >= dateFrom;
      const matchTo = !dateTo || a.timestamp <= dateTo;
      return matchSearch && matchFrom && matchTo;
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  const total = adjs.length;
  const perPage = AppState.adjPerPage;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (AppState.adjPage > totalPages) AppState.adjPage = 1;
  const page = adjs.slice((AppState.adjPage - 1) * perPage, AppState.adjPage * perPage);

  const tbody = $("adj-tbody");
  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 5v14"/><path d="M5 12l7-7 7 7"/></svg>
      <h3>No adjustments yet</h3><p>Create your first stock adjustment above.</p>
    </div></td></tr>`;
  } else {
    tbody.innerHTML = page.map(a => `
      <tr>
        <td><span class="code-chip">${esc(a.refNo)}</span></td>
        <td>${fmtDate(a.timestamp)}</td>
        <td><span class="code-chip">${esc(a.productCode)}</span></td>
        <td>${esc(a.productName)}</td>
        <td><span class="badge ${a.type === "ADD" ? "type-add" : "type-minus"}">${esc(a.type)}</span></td>
        <td class="mono">${fmtNum(a.quantity)}</td>
        <td>${esc(a.reason || "—")}</td>
        <td>${esc(a.performedBy || "—")}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="printAdjustment('${a.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print
          </button>
        </td>
      </tr>
    `).join("");
  }

  renderPagination("adj", total, AppState.adjPage, perPage);
}

function openAddAdjustment() {
  $("adj-ref").value = genRef("ADJ");
  $("adj-date").value = new Date().toISOString().split("T")[0];
  $("adj-product-code").value = "";
  $("adj-product-name").value = "";
  $("adj-product-id").value = "";
  $("adj-current-qty").textContent = "—";
  $("adj-type").value = "ADD";
  $("adj-qty").value = "";
  $("adj-reason").value = "";
  $("adj-remarks").value = "";
  $("adj-performed-by").value = AppState.currentUser?.username || "";
  $("adj-date-err").classList.remove("show");
  $("adj-product-code-err").textContent = "";
  $("adj-product-code-err").classList.remove("show");
  $("adj-qty-err").textContent = "Quantity must be greater than 0.";
  $("adj-qty-err").classList.remove("show");
  ["adj-date", "adj-product-code", "adj-qty"].forEach(id => $(id).classList.remove("error"));
  openModal("adj-modal");
}

function searchAdjProduct() {
  const code = $("adj-product-code").value.trim().toUpperCase();
  $("adj-product-code").value = code;
  const prod = Object.entries(AppState.products).find(([,p]) => p.productCode === code);
  if (prod) {
    const [id, p] = prod;
    $("adj-product-name").value = p.productName;
    $("adj-product-id").value = id;
    const qty = getQOH(id);
    $("adj-current-qty").textContent = fmtNum(qty);
    $("adj-product-code").classList.remove("error");
    $("adj-product-code-err").classList.remove("show");
  } else {
    $("adj-product-name").value = "";
    $("adj-product-id").value = "";
    $("adj-current-qty").textContent = "—";
    if (code) {
      $("adj-product-code").classList.add("error");
      $("adj-product-code-err").textContent = "Product not found.";
      $("adj-product-code-err").classList.add("show");
    } else {
      $("adj-product-code").classList.remove("error");
      $("adj-product-code-err").classList.remove("show");
    }
  }
}

async function saveAdjustment() {
  let valid = true;
  const selectedDate = $("adj-date").value;
  const pid = $("adj-product-id").value;
  const qty = Number($("adj-qty").value);

  $("adj-date").classList.remove("error");
  $("adj-product-code").classList.remove("error");
  $("adj-qty").classList.remove("error");
  $("adj-date-err").classList.remove("show");
  $("adj-product-code-err").classList.remove("show");
  $("adj-qty-err").classList.remove("show");
  $("adj-qty-err").textContent = "Quantity must be greater than 0.";

  if (!selectedDate) {
    $("adj-date").classList.add("error");
    $("adj-date-err").classList.add("show");
    valid = false;
  }

  if (!pid) {
    $("adj-product-code").classList.add("error");
    $("adj-product-code-err").textContent = "Please enter a valid product code.";
    $("adj-product-code-err").classList.add("show");
    valid = false;
  }
  if (!qty || qty <= 0 || isNaN(qty)) {
    $("adj-qty").classList.add("error");
    $("adj-qty-err").classList.add("show");
    valid = false;
  }
  if (!valid) return;

  const type = $("adj-type").value;
  const currentQty = getQOH(pid);

  // Validate MINUS doesn't exceed stock
  if (type === "MINUS" && qty > currentQty) {
    $("adj-qty").classList.add("error");
    $("adj-qty-err").textContent = `Cannot deduct ${qty}. Only ${currentQty} available.`;
    $("adj-qty-err").classList.add("show");
    return;
  }

  const p = AppState.products[pid];
  const newQty = type === "ADD" ? currentQty + qty : currentQty - qty;

  const adj = {
    refNo: $("adj-ref").value,
    timestamp: dateInputToTimestamp(selectedDate),
    date: selectedDate,
    productId: pid,
    productCode: p.productCode,
    productName: p.productName,
    type,
    quantity: qty,
    reason: $("adj-reason").value.trim(),
    remarks: $("adj-remarks").value.trim(),
    performedBy: $("adj-performed-by").value.trim() || AppState.currentUser?.username,
    prevQty: currentQty,
    newQty
  };

  const btn = $("save-adj-btn");
  btn.disabled = true;
  btn.textContent = "Saving...";
  try {
    await dbRefs.adjustments.push(adj);
    await writeLog({
      productId: pid,
      productCode: p.productCode,
      productName: p.productName,
      action: type === "ADD" ? "Stock Added" : "Stock Deducted",
      refNo: adj.refNo,
      prevQty: currentQty,
      adjQty: qty,
      newQty,
      remarks: adj.remarks
    });
    showToast(`Adjustment saved! New QOH: ${fmtNum(newQty)}`, "success");
    closeModal("adj-modal");
    renderAdjustments();
    if (AppState.currentSection === "inventory") renderInventory();
    if (AppState.currentSection === "dashboard") renderDashboard();
  } catch (err) {
    showToast("Error saving adjustment: " + err.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Save Adjustment";
  }
}

// ─────────────────────────────────────────────────────────────
// PRINT ADJUSTMENT REPORT
// ─────────────────────────────────────────────────────────────
function printAdjustment(id) {
  const a = AppState.adjustments[id];
  if (!a) return;
  const win = window.open("", "_blank", "width=780,height=600");
  win.document.write(`
    <!DOCTYPE html><html><head>
    <title>Adjustment Report</title>
    <style>
      body { font-family: 'Segoe UI', sans-serif; padding: 32px; color: #000; }
      .rpt-header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #000; padding-bottom: 16px; }
      .rpt-title { font-size: 22px; font-weight: 700; }
      .rpt-sub { font-size: 13px; color: #555; margin-top: 4px; }
      .rpt-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; margin: 20px 0; }
      .meta-item label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #777; display: block; margin-bottom: 2px; }
      .meta-item span { font-size: 14px; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; }
      th { background: #f0f0f0; padding: 8px 10px; text-align: left; border: 1px solid #ccc; font-size: 11px; text-transform: uppercase; }
      td { padding: 8px 10px; border: 1px solid #ccc; font-size: 13px; }
      .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; margin-top: 60px; }
      .sig-line { border-top: 1px solid #000; padding-top: 6px; text-align: center; font-size: 12px; color: #555; }
      .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
      .add { background: #d1fae5; color: #059669; }
      .minus { background: #fee2e2; color: #dc2626; }
    </style></head><body>
    <div class="rpt-header">
      <div class="rpt-title">📦 Inventory Monitoring System</div>
      <div class="rpt-sub">Stock Adjustment Report</div>
    </div>
    <div class="rpt-meta">
      <div class="meta-item"><label>Reference No.</label><span><strong>${esc(a.refNo)}</strong></span></div>
      <div class="meta-item"><label>Date</label><span>${esc(a.date || fmtDate(a.timestamp))}</span></div>
      <div class="meta-item"><label>Adjustment Type</label><span><span class="badge ${a.type === "ADD" ? "add" : "minus"}">${a.type}</span></span></div>
      <div class="meta-item"><label>Performed By</label><span>${esc(a.performedBy)}</span></div>
    </div>
    <table>
      <tr><th>Product Code</th><th>Product Name</th><th>Prev. Qty</th><th>Adj. Qty</th><th>New Qty</th></tr>
      <tr>
        <td>${esc(a.productCode)}</td>
        <td>${esc(a.productName)}</td>
        <td>${fmtNum(a.prevQty)}</td>
        <td><strong>${fmtNum(a.quantity)}</strong></td>
        <td><strong>${fmtNum(a.newQty)}</strong></td>
      </tr>
    </table>
    <div class="rpt-meta">
      <div class="meta-item"><label>Reason</label><span>${esc(a.reason || "—")}</span></div>
      <div class="meta-item"><label>Remarks</label><span>${esc(a.remarks || "—")}</span></div>
    </div>
    <div class="sig">
      <div class="sig-line">Prepared By<br><br><br>${esc(a.performedBy)}</div>
      <div class="sig-line">Approved By<br><br><br>____________________________</div>
    </div>
    <script>window.onload = () => window.print();<\/script>
    </body></html>
  `);
  win.document.close();
}

function printFilteredAdjustments() {
  const search = AppState.adjFilter.toLowerCase();
  const dateFrom = AppState.adjDateFrom ? new Date(AppState.adjDateFrom).getTime() : null;
  const dateTo = AppState.adjDateTo ? new Date(AppState.adjDateTo + "T23:59:59").getTime() : null;
  let adjs = Object.values(AppState.adjustments).filter(a => {
    const matchSearch = !search ||
      a.refNo?.toLowerCase().includes(search) ||
      a.productCode?.toLowerCase().includes(search) ||
      a.productName?.toLowerCase().includes(search);
    const matchFrom = !dateFrom || a.timestamp >= dateFrom;
    const matchTo = !dateTo || a.timestamp <= dateTo;
    return matchSearch && matchFrom && matchTo;
  }).sort((a, b) => b.timestamp - a.timestamp);

  const rows = adjs.map(a => `
    <tr>
      <td>${esc(a.refNo)}</td>
      <td>${esc(a.date || fmtDate(a.timestamp))}</td>
      <td>${esc(a.productCode)}</td>
      <td>${esc(a.productName)}</td>
      <td><span class="badge ${a.type === "ADD" ? "add" : "minus"}">${a.type}</span></td>
      <td>${fmtNum(a.quantity)}</td>
      <td>${esc(a.reason || "—")}</td>
      <td>${esc(a.performedBy)}</td>
    </tr>`).join("");

  const win = window.open("", "_blank", "width=900,height=600");
  win.document.write(`<!DOCTYPE html><html><head><title>Adjustments List</title>
    <style>body{font-family:'Segoe UI',sans-serif;padding:32px;color:#000}
    h2{font-size:18px;font-weight:700;margin-bottom:4px}.sub{font-size:12px;color:#555;margin-bottom:20px}
    table{width:100%;border-collapse:collapse}th{background:#f0f0f0;padding:7px 9px;border:1px solid #ccc;font-size:10px;text-transform:uppercase}
    td{padding:7px 9px;border:1px solid #ccc;font-size:12px}.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
    .add{background:#d1fae5;color:#059669}.minus{background:#fee2e2;color:#dc2626}</style></head><body>
    <h2>📦 Inventory Monitoring System — Adjustments List</h2>
    <p class="sub">Printed: ${new Date().toLocaleString()}</p>
    <table><tr><th>Ref No.</th><th>Date</th><th>Code</th><th>Product</th><th>Type</th><th>Qty</th><th>Reason</th><th>By</th></tr>
    ${rows}</table>
    <script>window.onload=()=>window.print();<\/script></body></html>`);
  win.document.close();
}

// ─────────────────────────────────────────────────────────────
// MONITORING LOGS MODULE
// ─────────────────────────────────────────────────────────────
function renderLogs() {
  const search = AppState.logFilter.toLowerCase();
  const actionF = AppState.logAction;
  const dateFrom = AppState.logDateFrom ? new Date(AppState.logDateFrom).getTime() : null;
  const dateTo = AppState.logDateTo ? new Date(AppState.logDateTo + "T23:59:59").getTime() : null;

  let logs = Object.entries(AppState.logs)
    .map(([id, l]) => ({ ...l, id }))
    .filter(l => {
      const matchSearch = !search ||
        l.productCode?.toLowerCase().includes(search) ||
        l.productName?.toLowerCase().includes(search) ||
        l.refNo?.toLowerCase().includes(search) ||
        l.action?.toLowerCase().includes(search);
      const matchAction = !actionF || l.action === actionF;
      const matchFrom = !dateFrom || l.timestamp >= dateFrom;
      const matchTo = !dateTo || l.timestamp <= dateTo;
      return matchSearch && matchAction && matchFrom && matchTo;
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  const total = logs.length;
  const perPage = AppState.logPerPage;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (AppState.logPage > totalPages) AppState.logPage = 1;
  const page = logs.slice((AppState.logPage - 1) * perPage, AppState.logPage * perPage);

  const tbody = $("log-tbody");
  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
      <h3>No logs found</h3><p>System activity will appear here.</p>
    </div></td></tr>`;
  } else {
    tbody.innerHTML = page.map(l => {
      const actionBadge = getActionBadge(l.action);
      return `<tr>
        <td class="mono" style="font-size:11px">${fmtDT(l.timestamp)}</td>
        <td><span class="code-chip">${esc(l.productCode || "—")}</span></td>
        <td>${esc(l.productName || "—")}</td>
        <td><span class="badge ${actionBadge}">${esc(l.action)}</span></td>
        <td><span class="code-chip">${esc(l.refNo || "—")}</span></td>
        <td class="mono">${l.prevQty !== "" ? fmtNum(l.prevQty) : "—"}</td>
        <td class="mono">${l.adjQty !== "" ? fmtNum(l.adjQty) : "—"}</td>
        <td class="mono">${l.newQty !== "" ? fmtNum(l.newQty) : "—"}</td>
        <td>${esc(l.performedBy || "—")}</td>
      </tr>`;
    }).join("");
  }
  renderPagination("log", total, AppState.logPage, perPage);

  // Populate action filter
  const allActions = [...new Set(Object.values(AppState.logs).map(l => l.action).filter(Boolean))];
  const sel = $("log-action-filter");
  const current = sel.value;
  sel.innerHTML = `<option value="">All Actions</option>` +
    allActions.map(a => `<option value="${esc(a)}" ${a === current ? "selected" : ""}>${esc(a)}</option>`).join("");
}

function getActionBadge(action) {
  if (!action) return "badge-gray";
  if (action.includes("Added")) return "badge-green";
  if (action.includes("Deleted")) return "badge-red";
  if (action.includes("Updated")) return "badge-blue";
  if (action.includes("Deducted")) return "badge-red";
  return "badge-gray";
}

// ─────────────────────────────────────────────────────────────
// CATEGORIES MODULE
// ─────────────────────────────────────────────────────────────
function renderCategories() {
  const cats = AppState.categories;
  const list = $("cat-items");
  if (!isAdmin()) {
    list.innerHTML = `<div class="empty-state"><p>Categories can only be managed by administrators.</p></div>`;
    populateCategorySelects();
    return;
  }
  if (!cats.length) {
    list.innerHTML = `<div class="empty-state"><p>No categories yet. Add one below.</p></div>`;
  } else {
    list.innerHTML = cats.map(c => `
      <div class="cat-pill" style="cursor:default">
        <span>${esc(c)}</span>
        <button class="del-cat" onclick='deleteCategory(${JSON.stringify(c)})' title="Delete">&times;</button>
      </div>
    `).join("");
  }
  // Populate category selects in forms
  populateCategorySelects();
}

function populateCategorySelects() {
  const cats = AppState.categories;
  ["pf-category", "inv-cat-filter", "master-cat-filter"].forEach(id => {
    const el = $(id);
    if (!el) return;
    const isFilter = id.includes("filter");
    const current = el.value;
    el.innerHTML = (isFilter ? `<option value="">All Categories</option>` : `<option value="">Select Category</option>`) +
      cats.map(c => `<option value="${esc(c)}" ${c === current ? "selected" : ""}>${esc(c)}</option>`).join("");
  });
}

function populateCategoryFilter(elId, selected) {
  const el = $(elId);
  if (!el) return;
  const cats = AppState.categories;
  el.innerHTML = `<option value="">All Categories</option>` +
    cats.map(c => `<option value="${esc(c)}" ${c === selected ? "selected" : ""}>${esc(c)}</option>`).join("");
}

async function addCategory() {
  if (!ensureAdminAccess("manage categories")) return;
  const input = $("cat-input");
  const name = input.value.trim();
  if (!name) return showToast("Enter a category name.", "warning");
  if (AppState.categories.some(cat => cat.toLowerCase() === name.toLowerCase())) return showToast("Category already exists.", "warning");
  const cats = [...AppState.categories, name];
  try {
    await dbRefs.categories.set(cats);
    input.value = "";
    showToast(`Category "${name}" added.`, "success");
  } catch (err) {
    showToast("Error adding category: " + err.message, "error");
  }
}

async function deleteCategory(name) {
  if (!ensureAdminAccess("manage categories")) return;
  showConfirm(
    "Delete Category",
    `Delete category "${name}"? Products with this category will not be affected.`,
    async () => {
      try {
        const cats = AppState.categories.filter(c => c !== name);
        await dbRefs.categories.set(cats);
        showToast(`Category "${name}" deleted.`, "warning");
      } catch (err) {
        showToast("Error deleting category: " + err.message, "error");
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────
// PAGINATION
// ─────────────────────────────────────────────────────────────
function renderPagination(key, total, current, perPage) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const el = $(`${key}-pagination`);
  if (!el) return;

  const start = (current - 1) * perPage + 1;
  const end = Math.min(current * perPage, total);
  const infoEl = $(`${key}-page-info`);
  if (infoEl) infoEl.textContent = total ? `Showing ${start}–${end} of ${total}` : "No records";

  const ctrl = el.querySelector(".pagination-controls");
  if (!ctrl) return;

  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= current - 1 && i <= current + 1)) pages.push(i);
    else if (pages[pages.length - 1] !== "…") pages.push("…");
  }

  ctrl.innerHTML = `
    <button class="page-btn" onclick="goPage('${key}',${current - 1})" ${current <= 1 ? "disabled" : ""}>‹ Prev</button>
    ${pages.map(p => p === "…"
      ? `<span style="padding:4px 6px;color:var(--text-muted)">…</span>`
      : `<button class="page-btn ${p === current ? "active" : ""}" onclick="goPage('${key}',${p})">${p}</button>`
    ).join("")}
    <button class="page-btn" onclick="goPage('${key}',${current + 1})" ${current >= totalPages ? "disabled" : ""}>Next ›</button>
  `;
}

function goPage(key, page) {
  if (page < 1) return;
  const stateKey = `${key}Page`;
  AppState[stateKey] = page;
  if (key === "master") renderMasterfile();
  if (key === "inv") renderInventory();
  if (key === "adj") renderAdjustments();
  if (key === "log") renderLogs();
}

// ─────────────────────────────────────────────────────────────
// MODALS
// ─────────────────────────────────────────────────────────────
function openModal(id) { $(id).classList.add("open"); }
function closeModal(id) { $(id).classList.remove("open"); }

// ─────────────────────────────────────────────────────────────
// EXCEL EXPORT (SheetJS)
// ─────────────────────────────────────────────────────────────
function exportToExcel(data, filename, sheetName) {
  if (!window.XLSX) return showToast("SheetJS not loaded.", "error");
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || "Sheet1");
  XLSX.writeFile(wb, filename + ".xlsx");
  showToast(`Exported to ${filename}.xlsx`, "success");
}

function exportMasterfile() {
  const data = Object.values(AppState.products).map(p => ({
    "Product Code": p.productCode,
    "Product Name": p.productName,
    "Serial No.": p.serialNo || "",
    "Category": p.category || "",
    "Unit Cost": p.unitCost,
    "Unit Price": p.unitPrice,
    "Reorder Point": getReorderPoint(p),
    "Description": p.description || "",
    "Date Created": fmtDate(p.dateCreated),
    "Last Updated": fmtDate(p.lastUpdated),
    "Photo URL": p.photoUrl || ""
  }));
  exportToExcel(data, "Masterfile-Export", "Masterfile");
}

function exportInventory() {
  const data = Object.entries(AppState.products).map(([id, p]) => {
    const qty = getQOH(id);
    return {
      "Product Code": p.productCode,
      "Product Name": p.productName,
      "Serial No.": p.serialNo || "",
      "Category": p.category || "",
      "Unit Cost": p.unitCost,
      "Unit Price": p.unitPrice,
      "Qty On Hand": qty,
      "Inventory Value": qty * Number(p.unitCost || 0),
      "Reorder Point": getReorderPoint(p),
      "Status": stockStatus(qty, getReorderPoint(p)).label
    };
  });
  exportToExcel(data, "Inventory-Export", "Inventory");
}

function exportAdjustments() {
  const data = Object.values(AppState.adjustments)
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(a => ({
      "Reference No.": a.refNo,
      "Date": fmtDate(a.timestamp),
      "Product Code": a.productCode,
      "Product Name": a.productName,
      "Type": a.type,
      "Quantity": a.quantity,
      "Prev. Qty": a.prevQty,
      "New Qty": a.newQty,
      "Reason": a.reason || "",
      "Remarks": a.remarks || "",
      "Performed By": a.performedBy || ""
    }));
  exportToExcel(data, "Adjustments-Export", "Adjustments");
}

function exportLogs() {
  const data = Object.values(AppState.logs)
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(l => ({
      "Date/Time": fmtDT(l.timestamp),
      "Product Code": l.productCode || "",
      "Product Name": l.productName || "",
      "Action": l.action,
      "Reference No.": l.refNo || "",
      "Prev. Qty": l.prevQty !== "" ? l.prevQty : "",
      "Adj. Qty": l.adjQty !== "" ? l.adjQty : "",
      "New Qty": l.newQty !== "" ? l.newQty : "",
      "Remarks": l.remarks || "",
      "Performed By": l.performedBy || ""
    }));
  exportToExcel(data, "MonitoringLogs-Export", "Logs");
}

// ─────────────────────────────────────────────────────────────
// THEME TOGGLE
// ─────────────────────────────────────────────────────────────
function toggleTheme() {
  const light = document.body.classList.toggle("light");
  localStorage.setItem("ims_theme", light ? "light" : "dark");
  $("theme-btn-text").textContent = light ? "Dark Mode" : "Light Mode";
}

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Theme
  const savedTheme = localStorage.getItem("ims_theme");
  if (savedTheme === "light") {
    document.body.classList.add("light");
    $("theme-btn-text").textContent = "Dark Mode";
  }

  // Login
  initLogin();

  // Navigation
  $$(".nav-item").forEach(el => {
    el.addEventListener("click", () => navigate(el.dataset.section));
  });

  // Confirm dialog buttons
  $("confirm-cancel").addEventListener("click", () => $("confirm-overlay").classList.remove("open"));

  // Hamburger
  $("hamburger").addEventListener("click", () => $("sidebar").classList.toggle("open"));

  // Logout
  $("logout-btn").addEventListener("click", logout);

  // Theme
  $("theme-btn").addEventListener("click", toggleTheme);

  // Photo upload
  initPhotoUpload();
  $("change-photo-btn").addEventListener("click", clearPendingPhoto);

  // Close modals on overlay click
  $$(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Masterfile
  $("add-product-btn").addEventListener("click", openAddProduct);
  $("save-product-btn").addEventListener("click", saveProduct);
  $("master-search").addEventListener("input", debounce(filterMasterfile, 300));
  $("master-cat-filter").addEventListener("change", e => {
    AppState.masterCatFilter = e.target.value;
    AppState.masterPage = 1;
    renderMasterfile();
  });

  // Inventory
  $("inv-search").addEventListener("input", debounce(() => {
    AppState.invFilter = $("inv-search").value;
    AppState.invPage = 1;
    renderInventory();
  }, 300));
  $("inv-cat-filter").addEventListener("change", e => {
    AppState.invCatFilter = e.target.value;
    AppState.invPage = 1;
    renderInventory();
  });
  $("inv-sort").addEventListener("change", e => {
    AppState.invSort = e.target.value;
    renderInventory();
  });

  // Adjustments
  $("add-adj-btn").addEventListener("click", openAddAdjustment);
  $("save-adj-btn").addEventListener("click", saveAdjustment);
  $("adj-search").addEventListener("input", debounce(() => {
    AppState.adjFilter = $("adj-search").value;
    AppState.adjPage = 1;
    renderAdjustments();
  }, 300));
  $("adj-date-from").addEventListener("change", e => { AppState.adjDateFrom = e.target.value; AppState.adjPage = 1; renderAdjustments(); });
  $("adj-date-to").addEventListener("change", e => { AppState.adjDateTo = e.target.value; AppState.adjPage = 1; renderAdjustments(); });
  $("adj-product-code").addEventListener("blur", searchAdjProduct);
  $("adj-product-code").addEventListener("keydown", e => { if (e.key === "Enter") searchAdjProduct(); });
  $("print-filtered-btn").addEventListener("click", printFilteredAdjustments);

  // Logs
  $("log-search").addEventListener("input", debounce(() => {
    AppState.logFilter = $("log-search").value;
    AppState.logPage = 1;
    renderLogs();
  }, 300));
  $("log-action-filter").addEventListener("change", e => { AppState.logAction = e.target.value; AppState.logPage = 1; renderLogs(); });
  $("log-date-from").addEventListener("change", e => { AppState.logDateFrom = e.target.value; AppState.logPage = 1; renderLogs(); });
  $("log-date-to").addEventListener("change", e => { AppState.logDateTo = e.target.value; AppState.logPage = 1; renderLogs(); });

  // Categories
  $("cat-add-btn").addEventListener("click", addCategory);
  $("cat-input").addEventListener("keydown", e => { if (e.key === "Enter") addCategory(); });

  // Export buttons
  $("export-master-btn").addEventListener("click", exportMasterfile);
  $("export-inv-btn").addEventListener("click", exportInventory);
  $("export-adj-btn").addEventListener("click", exportAdjustments);
  $("export-log-btn").addEventListener("click", exportLogs);

  // Navigate to dashboard by default
  navigate("dashboard");
});
