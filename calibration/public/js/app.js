/* ═══════════════════════════════════════════
   CalTrack Demo — Public App Logic
   ═══════════════════════════════════════════ */

let allEquipment = [];

// ─── Theme ─────────────────────────────────
function loadTheme() {
  const theme = localStorage.getItem('cal-theme');
  if (theme === 'dark') {
    document.body.classList.add('dark-theme');
  }
  document.documentElement.classList.remove('dark-theme-loading');
  updateThemeIcon();
}

function toggleTheme() {
  document.body.classList.toggle('dark-theme');
  const isDark = document.body.classList.contains('dark-theme');
  localStorage.setItem('cal-theme', isDark ? 'dark' : 'light');
  updateThemeIcon();
}

function updateThemeIcon() {
  const icons = document.querySelectorAll('.theme-toggle i');
  const isDark = document.body.classList.contains('dark-theme');
  icons.forEach(icon => {
    icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
  });
}

// ─── Mobile Menu ───────────────────────────
function toggleMobileMenu() {
  const menu = document.querySelector('.mobile-menu');
  menu.classList.toggle('open');
}

function closeMobileMenu() {
  const menu = document.querySelector('.mobile-menu');
  menu.classList.remove('open');
}

// ─── Calibration Status ────────────────────
function getCalibrationStatus(dueDate) {
  if (!dueDate) return { status: 'valid', label: 'N/A', icon: 'fa-circle-question' };

  const now = new Date();
  const due = new Date(dueDate);
  const daysUntilDue = Math.ceil((due - now) / (1000 * 60 * 60 * 24));

  if (daysUntilDue < 0) {
    return { status: 'expired', label: 'Expired', icon: 'fa-circle-xmark' };
  } else if (daysUntilDue <= 30) {
    return { status: 'due-soon', label: 'Due Soon', icon: 'fa-circle-exclamation' };
  } else {
    return { status: 'valid', label: 'Valid', icon: 'fa-circle-check' };
  }
}

function createStatusBadge(dueDate, large) {
  const { status, label, icon } = getCalibrationStatus(dueDate);
  const sizeClass = large ? ' status-badge-lg' : '';
  return `<span class="status-badge ${status}${sizeClass}"><i class="fas ${icon}"></i> ${label}</span>`;
}

// ─── Date Formatting ───────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── API Helpers ───────────────────────────
async function fetchAllEquipment() {
  const res = await fetch(`${CONFIG.API_BASE}/equipment`);
  if (!res.ok) throw new Error('Failed to fetch equipment');
  return res.json();
}

async function fetchEquipment(id) {
  const res = await fetch(`${CONFIG.API_BASE}/equipment/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('Equipment not found');
  return res.json();
}

// ─── Landing Page ──────────────────────────
function renderEquipmentGrid(equipment) {
  const grid = document.getElementById('equipmentGrid');
  const countEl = document.getElementById('equipmentCount');
  const emptyState = document.getElementById('emptyState');
  const noResults = document.getElementById('noResults');

  if (!grid) return;

  grid.innerHTML = '';
  emptyState.style.display = 'none';
  noResults.style.display = 'none';

  if (allEquipment.length === 0) {
    emptyState.style.display = 'block';
    countEl.textContent = '';
    return;
  }

  if (equipment.length === 0) {
    noResults.style.display = 'block';
    countEl.textContent = `0 of ${allEquipment.length}`;
    return;
  }

  countEl.textContent = equipment.length === allEquipment.length
    ? `${equipment.length} items`
    : `${equipment.length} of ${allEquipment.length}`;

  equipment.forEach(eq => {
    const card = document.createElement('div');
    card.className = 'equipment-card';
    card.onclick = () => window.location.href = `equipment.html?id=${encodeURIComponent(eq.equipment_id)}`;
    card.innerHTML = `
      <div class="card-header">
        <span class="card-id">${escapeHtml(eq.equipment_id)}</span>
        ${createStatusBadge(eq.calibration_due_date)}
      </div>
      <h3 class="card-name">${escapeHtml(eq.name)}</h3>
      <div class="card-details">
        <div class="detail-row">
          <span class="label">Serial Number</span>
          <span>${escapeHtml(eq.serial_number)}</span>
        </div>
        <div class="detail-row">
          <span class="label">Due Date</span>
          <span>${formatDate(eq.calibration_due_date)}</span>
        </div>
      </div>
      <div class="card-footer">
        <span class="view-link">View Details <i class="fas fa-arrow-right"></i></span>
      </div>
    `;
    grid.appendChild(card);
  });
}

function searchEquipment(query) {
  const q = query.toLowerCase().trim();
  if (!q) return allEquipment;
  return allEquipment.filter(eq =>
    eq.equipment_id.toLowerCase().includes(q) ||
    eq.serial_number.toLowerCase().includes(q) ||
    eq.name.toLowerCase().includes(q)
  );
}

function clearSearch() {
  const input = document.getElementById('searchInput');
  if (input) {
    input.value = '';
    document.getElementById('searchClear').style.display = 'none';
    renderEquipmentGrid(allEquipment);
  }
}

async function initLandingPage() {
  try {
    allEquipment = await fetchAllEquipment();
    document.getElementById('loadingSpinner').style.display = 'none';
    renderEquipmentGrid(allEquipment);

    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');
    searchInput.addEventListener('input', () => {
      const query = searchInput.value;
      searchClear.style.display = query ? 'block' : 'none';
      renderEquipmentGrid(searchEquipment(query));
    });
  } catch (err) {
    console.error(err);
    document.getElementById('loadingSpinner').innerHTML =
      '<p style="color:var(--status-expired);">Failed to load equipment data.</p>';
  }
}

// ─── Equipment Detail Page ─────────────────
let currentEquipment = null;

async function initEquipmentPage() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  const spinner = document.getElementById('loadingSpinner');
  const errorState = document.getElementById('errorState');
  const detail = document.getElementById('equipmentDetail');

  if (!id) {
    spinner.style.display = 'none';
    errorState.style.display = 'block';
    return;
  }

  try {
    currentEquipment = await fetchEquipment(id);
    spinner.style.display = 'none';
    detail.style.display = 'block';

    document.title = `${currentEquipment.name} — CalTrack Demo`;
    document.getElementById('equipName').textContent = currentEquipment.name;
    document.getElementById('equipId').textContent = currentEquipment.equipment_id;
    document.getElementById('statusBadgeContainer').innerHTML = createStatusBadge(currentEquipment.calibration_due_date, true);

    document.getElementById('detailEquipId').textContent = currentEquipment.equipment_id;
    document.getElementById('detailSerial').textContent = currentEquipment.serial_number;
    document.getElementById('detailRange').textContent = currentEquipment.calibration_range || '—';
    document.getElementById('detailInterval').textContent = currentEquipment.interval_months ? `${currentEquipment.interval_months} months` : '—';
    document.getElementById('detailCalDate').textContent = formatDate(currentEquipment.date_of_calibration);
    document.getElementById('detailDueDate').textContent = formatDate(currentEquipment.calibration_due_date);
    document.getElementById('detailCertNumber').textContent = currentEquipment.certificate_number || '—';

    // Hide cert button if no certificate
    if (!currentEquipment.certificate_number) {
      document.getElementById('viewCertBtn').style.display = 'none';
    }
  } catch (err) {
    spinner.style.display = 'none';
    errorState.style.display = 'block';
  }
}

// ─── Certificate Viewing ───────────────────
function handleCertificateView() {
  // Check sessionStorage for cached auth
  const cached = sessionStorage.getItem('cert-auth');
  if (cached) {
    openCertificate(cached);
    return;
  }
  openPasswordModal();
}

function openPasswordModal() {
  document.getElementById('passwordModal').classList.add('open');
  document.getElementById('certPassword').value = '';
  document.getElementById('certPasswordError').style.display = 'none';
  document.getElementById('certPassword').focus();
}

function closePasswordModal() {
  document.getElementById('passwordModal').classList.remove('open');
}

async function submitCertPassword(e) {
  e.preventDefault();
  const password = document.getElementById('certPassword').value;
  const errorEl = document.getElementById('certPasswordError');
  const btn = document.getElementById('certSubmitBtn');

  btn.querySelector('.btn-text').style.display = 'none';
  btn.querySelector('.btn-loading').style.display = 'inline';
  btn.disabled = true;
  errorEl.style.display = 'none';

  try {
    const res = await fetch(`${CONFIG.API_BASE}/verify-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    if (!res.ok) {
      errorEl.textContent = 'Invalid password. Please try again.';
      errorEl.style.display = 'block';
      return;
    }

    sessionStorage.setItem('cert-auth', password);
    closePasswordModal();
    openCertificate(password);
  } catch (err) {
    errorEl.textContent = 'Connection error. Please try again.';
    errorEl.style.display = 'block';
  } finally {
    btn.querySelector('.btn-text').style.display = 'inline';
    btn.querySelector('.btn-loading').style.display = 'none';
    btn.disabled = false;
  }
}

async function openCertificate(password) {
  if (!currentEquipment || !currentEquipment.certificate_number) return;

  try {
    const res = await fetch(`${CONFIG.API_BASE}/certificate/${encodeURIComponent(currentEquipment.certificate_number)}`, {
      headers: { 'x-cert-password': password }
    });

    if (res.status === 401) {
      sessionStorage.removeItem('cert-auth');
      openPasswordModal();
      return;
    }

    if (!res.ok) {
      alert('Certificate file not found.');
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  } catch (err) {
    alert('Failed to load certificate.');
  }
}

// ─── Password Visibility Toggle ────────────
function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  const icon = input.parentElement.querySelector('.password-toggle i');
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'fas fa-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'fas fa-eye';
  }
}

// ─── Escape HTML ───────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Init ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadTheme();

  // Footer year
  const yearEl = document.getElementById('footerYear');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Page-specific init
  const page = document.body.dataset.page;
  if (page === 'landing') initLandingPage();
  if (page === 'equipment') initEquipmentPage();
});
