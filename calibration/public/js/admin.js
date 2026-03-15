/* ═══════════════════════════════════════════
   CalTrack Demo — Admin Panel Logic
   ═══════════════════════════════════════════ */

let adminPassword = null;
let adminEquipment = [];
let editingId = null;
let deletingId = null;

// ─── Admin Login ───────────────────────────
async function adminLogin(e) {
  e.preventDefault();
  const password = document.getElementById('adminPassword').value;
  const errorEl = document.getElementById('adminLoginError');
  const btn = document.getElementById('loginBtn');

  btn.querySelector('.btn-text').style.display = 'none';
  btn.querySelector('.btn-loading').style.display = 'inline';
  btn.disabled = true;
  errorEl.style.display = 'none';

  try {
    const res = await fetch(`${CONFIG.API_BASE}/admin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    if (!res.ok) {
      errorEl.textContent = 'Invalid admin password.';
      errorEl.style.display = 'block';
      return;
    }

    adminPassword = password;
    sessionStorage.setItem('admin-auth', password);
    document.getElementById('loginGate').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    loadAdminPanel();
  } catch (err) {
    errorEl.textContent = 'Connection error. Please try again.';
    errorEl.style.display = 'block';
  } finally {
    btn.querySelector('.btn-text').style.display = 'inline';
    btn.querySelector('.btn-loading').style.display = 'none';
    btn.disabled = false;
  }
}

function adminLogout() {
  adminPassword = null;
  sessionStorage.removeItem('admin-auth');
  document.getElementById('loginGate').style.display = 'flex';
  document.getElementById('adminPanel').style.display = 'none';
  document.getElementById('adminPassword').value = '';
}

// ─── Load Admin Panel ──────────────────────
async function loadAdminPanel() {
  const loading = document.getElementById('adminLoading');
  const table = document.getElementById('tableContainer');
  const empty = document.getElementById('adminEmpty');

  loading.style.display = 'block';
  table.style.display = 'none';
  empty.style.display = 'none';

  try {
    adminEquipment = await fetchAllEquipment();
    loading.style.display = 'none';

    if (adminEquipment.length === 0) {
      empty.style.display = 'block';
      return;
    }

    table.style.display = 'block';
    renderAdminTable();
  } catch (err) {
    loading.innerHTML = '<p style="color:var(--status-expired);">Failed to load equipment.</p>';
  }
}

function renderAdminTable() {
  const tbody = document.getElementById('adminTableBody');
  tbody.innerHTML = '';

  adminEquipment.forEach(eq => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(eq.equipment_id)}</strong></td>
      <td>${escapeHtml(eq.name)}</td>
      <td>${escapeHtml(eq.serial_number)}</td>
      <td>${formatDate(eq.calibration_due_date)}</td>
      <td>${createStatusBadge(eq.calibration_due_date)}</td>
      <td class="actions-cell">
        <button class="btn btn-secondary btn-sm" onclick="showEquipmentForm('${escapeHtml(eq.equipment_id)}')" title="Edit">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn btn-secondary btn-sm" onclick="showQRModal('${escapeHtml(eq.equipment_id)}')" title="QR Code">
          <i class="fas fa-qrcode"></i>
        </button>
        <button class="btn btn-danger btn-sm" onclick="showDeleteModal('${escapeHtml(eq.equipment_id)}')" title="Delete">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Equipment Form ────────────────────────
function showEquipmentForm(equipId) {
  editingId = equipId || null;
  const modal = document.getElementById('equipmentModal');
  const title = document.getElementById('formModalTitle');
  const idInput = document.getElementById('formEquipId');
  const form = document.getElementById('equipmentForm');

  form.reset();
  document.getElementById('formError').style.display = 'none';

  if (editingId) {
    title.innerHTML = '<i class="fas fa-edit"></i> Edit Equipment';
    idInput.disabled = true;
    const eq = adminEquipment.find(e => e.equipment_id === editingId);
    if (eq) {
      idInput.value = eq.equipment_id;
      document.getElementById('formSerial').value = eq.serial_number;
      document.getElementById('formName').value = eq.name;
      document.getElementById('formRange').value = eq.calibration_range || '';
      document.getElementById('formInterval').value = eq.interval_months || '';
      document.getElementById('formCalDate').value = eq.date_of_calibration || '';
      document.getElementById('formDueDate').value = eq.calibration_due_date || '';
      document.getElementById('formCertNumber').value = eq.certificate_number || '';
    }
  } else {
    title.innerHTML = '<i class="fas fa-plus"></i> Add Equipment';
    idInput.disabled = false;
  }

  modal.classList.add('open');
}

function closeEquipmentForm() {
  document.getElementById('equipmentModal').classList.remove('open');
  editingId = null;
}

async function saveEquipment(e) {
  e.preventDefault();
  const errorEl = document.getElementById('formError');
  const btn = document.getElementById('formSubmitBtn');

  const data = {
    equipment_id: document.getElementById('formEquipId').value.trim(),
    serial_number: document.getElementById('formSerial').value.trim(),
    name: document.getElementById('formName').value.trim(),
    calibration_range: document.getElementById('formRange').value.trim() || null,
    interval_months: parseInt(document.getElementById('formInterval').value) || null,
    date_of_calibration: document.getElementById('formCalDate').value || null,
    calibration_due_date: document.getElementById('formDueDate').value || null,
    certificate_number: document.getElementById('formCertNumber').value.trim() || null,
  };

  btn.querySelector('.btn-text').style.display = 'none';
  btn.querySelector('.btn-loading').style.display = 'inline';
  btn.disabled = true;
  errorEl.style.display = 'none';

  try {
    const isEdit = !!editingId;
    const url = isEdit
      ? `${CONFIG.API_BASE}/equipment/${encodeURIComponent(editingId)}`
      : `${CONFIG.API_BASE}/equipment`;

    const res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': adminPassword,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json();
      errorEl.textContent = err.error || 'Failed to save equipment.';
      errorEl.style.display = 'block';
      return;
    }

    // Upload certificate if file selected
    const certFile = document.getElementById('formCertFile').files[0];
    if (certFile && data.certificate_number) {
      await uploadCertificate(certFile, data.certificate_number);
    }

    closeEquipmentForm();
    await loadAdminPanel();
  } catch (err) {
    errorEl.textContent = 'Connection error. Please try again.';
    errorEl.style.display = 'block';
  } finally {
    btn.querySelector('.btn-text').style.display = 'inline';
    btn.querySelector('.btn-loading').style.display = 'none';
    btn.disabled = false;
  }
}

async function uploadCertificate(file, certNumber) {
  const formData = new FormData();
  formData.append('certificate', file);
  formData.append('certificate_number', certNumber);

  await fetch(`${CONFIG.API_BASE}/upload-certificate`, {
    method: 'POST',
    headers: { 'x-admin-password': adminPassword },
    body: formData,
  });
}

// ─── Delete ────────────────────────────────
function showDeleteModal(equipId) {
  deletingId = equipId;
  document.getElementById('deleteEquipId').textContent = equipId;
  document.getElementById('deleteModal').classList.add('open');
}

function closeDeleteModal() {
  document.getElementById('deleteModal').classList.remove('open');
  deletingId = null;
}

async function confirmDelete() {
  if (!deletingId) return;
  const btn = document.getElementById('confirmDeleteBtn');

  btn.querySelector('.btn-text').style.display = 'none';
  btn.querySelector('.btn-loading').style.display = 'inline';
  btn.disabled = true;

  try {
    const res = await fetch(`${CONFIG.API_BASE}/equipment/${encodeURIComponent(deletingId)}`, {
      method: 'DELETE',
      headers: { 'x-admin-password': adminPassword },
    });

    if (!res.ok) {
      alert('Failed to delete equipment.');
      return;
    }

    closeDeleteModal();
    await loadAdminPanel();
  } catch (err) {
    alert('Connection error.');
  } finally {
    btn.querySelector('.btn-text').style.display = 'inline';
    btn.querySelector('.btn-loading').style.display = 'none';
    btn.disabled = false;
  }
}

// ─── QR Code ───────────────────────────────
let currentQR = null;

function showQRModal(equipId) {
  const modal = document.getElementById('qrModal');
  const container = document.getElementById('qrCodeContainer');
  const urlEl = document.getElementById('qrUrl');
  const idEl = document.getElementById('qrEquipId');

  const url = `${CONFIG.BASE_URL}/equipment.html?id=${encodeURIComponent(equipId)}`;

  idEl.textContent = equipId;
  urlEl.textContent = url;
  container.innerHTML = '';

  modal.classList.add('open');

  // Generate QR code
  currentQR = new QRCode(container, {
    text: url,
    width: 200,
    height: 200,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H,
  });
}

function closeQRModal() {
  document.getElementById('qrModal').classList.remove('open');
  currentQR = null;
}

function downloadQR() {
  const canvas = document.querySelector('#qrCodeContainer canvas');
  if (!canvas) return;

  const link = document.createElement('a');
  link.download = `QR-${document.getElementById('qrEquipId').textContent}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function printQR() {
  const equipId = document.getElementById('qrEquipId').textContent;
  const canvas = document.querySelector('#qrCodeContainer canvas');
  if (!canvas) return;

  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>QR Label — ${equipId}</title>
      <style>
        body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: Arial, sans-serif; margin: 0; }
        img { width: 200px; height: 200px; }
        h2 { margin-top: 12px; font-size: 18px; }
        p { font-size: 11px; color: #666; margin-top: 4px; }
      </style>
    </head>
    <body>
      <img src="${canvas.toDataURL('image/png')}" alt="QR Code">
      <h2>${equipId}</h2>
      <p>${CONFIG.COMPANY_NAME}</p>
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.onload = () => {
    printWindow.print();
  };
}

// ─── Admin Init ────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Check for cached admin session
  const cached = sessionStorage.getItem('admin-auth');
  if (cached) {
    adminPassword = cached;
    document.getElementById('loginGate').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    loadAdminPanel();
  }
});
