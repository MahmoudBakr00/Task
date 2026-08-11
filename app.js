// ============================================================
// متابعة تنفيذ المهام — منطق التطبيق الرئيسي
// ============================================================

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let tasks = [];
let editingTaskId = null;
let notifiedKeys = new Set(JSON.parse(localStorage.getItem('notifiedKeys') || '[]'));

const REFRESH_INTERVAL_MS = 30 * 1000;
const CHECK_NOTIFY_INTERVAL_MS = 60 * 1000;

(async function init() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = 'index.html';
    return;
  }
  currentUser = data.session.user;
  document.getElementById('userEmailLabel').textContent = currentUser.email || 'أدمن';

  bindUI();
  restoreNotifyState();
  await loadTasks();
  setInterval(refreshView, REFRESH_INTERVAL_MS);
  setInterval(checkDueNotifications, CHECK_NOTIFY_INTERVAL_MS);
})();

const UNIT_MS = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
  weeks: 7 * 24 * 60 * 60 * 1000,
};

function intervalMs(task) {
  if (task.review_mode !== 'recurring' || !task.recurrence_value || !task.recurrence_unit) return null;
  return task.recurrence_value * UNIT_MS[task.recurrence_unit];
}

function warnWindowMs(task) {
  const iv = intervalMs(task);
  if (iv) {
    return Math.min(Math.max(iv * 0.25, 5 * 60 * 1000), 3 * 60 * 60 * 1000);
  }
  return 60 * 60 * 1000;
}

function computeStatus(task) {
  if (task.status === 'done') return { key: 'done', label: 'منتهية' };
  if (task.status === 'paused') return { key: 'done', label: 'متوقفة' };

  const now = Date.now();
  const due = new Date(task.review_at).getTime();
  const diff = due - now;

  if (diff <= 0) return { key: 'late', label: 'متأخرة', diff };
  if (diff <= warnWindowMs(task)) return { key: 'warn', label: 'قربت تستحق', diff };
  return { key: 'ok', label: 'في الموعد', diff };
}

function formatRelative(diffMs) {
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60000);
  const hrs = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);

  let text;
  if (mins < 60) text = `${mins} د`;
  else if (hrs < 24) text = `${hrs} س`;
  else text = `${days} يوم`;

  return diffMs <= 0 ? `متأخرة بـ ${text}` : `متبقي ${text}`;
}

function formatExact(iso) {
  const d = new Date(iso);
  return d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

async function loadTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .neq('status', 'done')
    .order('review_at', { ascending: true });

  if (error) {
    toast('حصل خطأ في تحميل المهام: ' + error.message, 'error');
    return;
  }
  tasks = data || [];
  populateFilterOptions();
  refreshView();
}

function refreshView() {
  renderStats();
  renderTaskList();
}

function renderStats() {
  let late = 0, warn = 0, ok = 0;
  tasks.forEach(t => {
    const s = computeStatus(t);
    if (s.key === 'late') late++;
    else if (s.key === 'warn') warn++;
    else if (s.key === 'ok') ok++;
  });
  document.getElementById('statLate').textContent = late;
  document.getElementById('statWarn').textContent = warn;
  document.getElementById('statOk').textContent = ok;
  document.getElementById('statTotal').textContent = tasks.length;
}

function populateFilterOptions() {
  fillDistinct('filterLine', tasks.map(t => t.line));
  fillDistinct('filterStage', tasks.map(t => t.stage));
  fillDistinct('filterSupervisor', tasks.map(t => t.supervisor_name));

  fillDatalist('dl_lines', tasks.map(t => t.line));
  fillDatalist('dl_stages', tasks.map(t => t.stage));
  fillDatalist('dl_supervisors', tasks.map(t => t.supervisor_name));
  fillDatalist('dl_employees', tasks.map(t => t.employee_name));
}

function fillDistinct(selectId, values) {
  const select = document.getElementById(selectId);
  const current = select.value;
  const unique = [...new Set(values.filter(Boolean))].sort();
  const placeholder = select.options[0];
  select.innerHTML = '';
  select.appendChild(placeholder);
  unique.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
  select.value = unique.includes(current) ? current : '';
}

function fillDatalist(dlId, values) {
  const dl = document.getElementById(dlId);
  const unique = [...new Set(values.filter(Boolean))].sort();
  dl.innerHTML = '';
  unique.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    dl.appendChild(opt);
  });
}

function getFilteredSortedTasks() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const fLine = document.getElementById('filterLine').value;
  const fStage = document.getElementById('filterStage').value;
  const fSup = document.getElementById('filterSupervisor').value;
  const fStatus = document.getElementById('filterStatus').value;
  const sortBy = document.getElementById('sortBy').value;

  let list = tasks.filter(t => {
    if (fLine && t.line !== fLine) return false;
    if (fStage && t.stage !== fStage) return false;
    if (fSup && t.supervisor_name !== fSup) return false;
    if (fStatus && computeStatus(t).key !== fStatus) return false;
    if (search) {
      const hay = `${t.employee_name} ${t.employee_code || ''} ${t.task_description}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  list.sort((a, b) => {
    if (sortBy === 'review_at_asc') return new Date(a.review_at) - new Date(b.review_at);
    if (sortBy === 'review_at_desc') return new Date(b.review_at) - new Date(a.review_at);
    if (sortBy === 'created_desc') return new Date(b.created_at) - new Date(a.created_at);
    return 0;
  });

  return list;
}

function renderTaskList() {
  const container = document.getElementById('taskList');
  const empty = document.getElementById('emptyState');
  const list = getFilteredSortedTasks();

  if (list.length === 0) {
    container.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  container.innerHTML = list.map(t => rowTemplate(t)).join('');

  list.forEach(t => {
    document.getElementById(`review-${t.id}`)?.addEventListener('click', () => markReviewed(t.id));
    document.getElementById(`edit-${t.id}`)?.addEventListener('click', () => openModal(t));
    document.getElementById(`del-${t.id}`)?.addEventListener('click', () => deleteTask(t.id));
  });
}

function rowTemplate(t) {
  const status = computeStatus(t);
  const pulse = status.key === 'late' ? 'pulse' : '';
  const modeLabel = t.review_mode === 'recurring'
    ? `كل ${t.recurrence_value} ${unitLabel(t.recurrence_unit)}`
    : 'مرة واحدة';

  return `
  <div class="task-row">
    <div class="status-strip ${status.key} ${pulse}"></div>
    <div class="cell-employee">
      <div class="name">${escapeHtml(t.employee_name)}</div>
      ${t.employee_code ? `<div class="code">#${escapeHtml(t.employee_code)}</div>` : ''}
    </div>
    <div class="cell-line">
      ${t.line ? `<span class="tag">${escapeHtml(t.line)}</span>` : ''}
      ${t.stage ? `<div class="stage">${escapeHtml(t.stage)}</div>` : ''}
    </div>
    <div class="cell-task">
      ${escapeHtml(t.task_description)}
      ${t.supervisor_name ? `<div class="supervisor">👤 ${escapeHtml(t.supervisor_name)}</div>` : ''}
    </div>
    <div class="cell-mode">${modeLabel}</div>
    <div class="cell-time">
      <span class="badge ${status.key}">${formatRelative(status.diff)}</span>
      <div class="exact">${formatExact(t.review_at)}</div>
    </div>
    <div class="cell-actions">
      <button class="btn btn-sm btn-primary" id="review-${t.id}">تمت المراجعة</button>
      <button class="icon-btn" id="edit-${t.id}" title="تعديل">✎</button>
      <button class="icon-btn" id="del-${t.id}" title="حذف">🗑</button>
    </div>
  </div>`;
}

function unitLabel(unit) {
  return { minutes: 'دقيقة', hours: 'ساعة', days: 'يوم', weeks: 'أسبوع' }[unit] || unit;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bindFilterEvents() {
  ['searchInput', 'filterLine', 'filterStage', 'filterSupervisor', 'filterStatus', 'sortBy']
    .forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', renderTaskList);
      el.addEventListener('change', renderTaskList);
    });
}

function bindUI() {
  document.getElementById('addTaskBtn').addEventListener('click', () => openModal(null));
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
  document.getElementById('taskModal').addEventListener('click', (e) => {
    if (e.target.id === 'taskModal') closeModal();
  });

  document.getElementById('modeOnceBtn').addEventListener('click', () => setMode('once'));
  document.getElementById('modeRecurringBtn').addEventListener('click', () => setMode('recurring'));

  document.getElementById('taskForm').addEventListener('submit', saveTask);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('notifyBtn').addEventListener('click', toggleNotifications);

  bindFilterEvents();
}

let currentMode = 'once';
function setMode(mode) {
  currentMode = mode;
  document.getElementById('modeOnceBtn').classList.toggle('active', mode === 'once');
  document.getElementById('modeRecurringBtn').classList.toggle('active', mode === 'recurring');
  document.getElementById('onceRow').hidden = mode !== 'once';
  document.getElementById('recurringRow').hidden = mode !== 'recurring';
}

function openModal(task) {
  editingTaskId = task ? task.id : null;
  document.getElementById('modalTitle').textContent = task ? 'تعديل المهمة' : 'مهمة جديدة';

  document.getElementById('f_employee_name').value = task?.employee_name || '';
  document.getElementById('f_employee_code').value = task?.employee_code || '';
  document.getElementById('f_line').value = task?.line || '';
  document.getElementById('f_stage').value = task?.stage || '';
  document.getElementById('f_task').value = task?.task_description || '';
  document.getElementById('f_supervisor').value = task?.supervisor_name || '';
  document.getElementById('f_notes').value = task?.notes || '';

  const mode = task?.review_mode || 'once';
  setMode(mode);

  if (mode === 'once') {
    document.getElementById('f_review_at').value = task ? toLocalInput(task.review_at) : '';
  } else {
    document.getElementById('f_recurrence_value').value = task?.recurrence_value || 2;
    document.getElementById('f_recurrence_unit').value = task?.recurrence_unit || 'hours';
    document.getElementById('f_first_review_at').value = task ? toLocalInput(task.review_at) : '';
  }

  document.getElementById('taskModal').hidden = false;
}

function closeModal() {
  document.getElementById('taskModal').hidden = true;
  document.getElementById('taskForm').reset();
  editingTaskId = null;
}

function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function saveTask(e) {
  e.preventDefault();
  const saveBtn = document.getElementById('saveTaskBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'جاري الحفظ...';

  const payload = {
    employee_name: document.getElementById('f_employee_name').value.trim(),
    employee_code: document.getElementById('f_employee_code').value.trim() || null,
    line: document.getElementById('f_line').value.trim() || null,
    stage: document.getElementById('f_stage').value.trim() || null,
    task_description: document.getElementById('f_task').value.trim(),
    supervisor_name: document.getElementById('f_supervisor').value.trim() || null,
    notes: document.getElementById('f_notes').value.trim() || null,
    review_mode: currentMode,
    status: 'active',
  };

  if (currentMode === 'once') {
    const val = document.getElementById('f_review_at').value;
    if (!val) { toast('حدد معاد المراجعة', 'error'); resetSaveBtn(); return; }
    payload.review_at = new Date(val).toISOString();
    payload.recurrence_value = null;
    payload.recurrence_unit = null;
  } else {
    const val = document.getElementById('f_first_review_at').value;
    if (!val) { toast('حدد أول موعد مراجعة', 'error'); resetSaveBtn(); return; }
    payload.review_at = new Date(val).toISOString();
    payload.recurrence_value = parseInt(document.getElementById('f_recurrence_value').value, 10);
    payload.recurrence_unit = document.getElementById('f_recurrence_unit').value;
  }

  let error;
  if (editingTaskId) {
    ({ error } = await supabase.from('tasks').update(payload).eq('id', editingTaskId));
  } else {
    ({ error } = await supabase.from('tasks').insert(payload));
  }

  resetSaveBtn();

  if (error) {
    toast('حصل خطأ أثناء الحفظ: ' + error.message, 'error');
    return;
  }

  toast(editingTaskId ? 'تم تعديل المهمة' : 'تمت إضافة المهمة', 'success');
  closeModal();
  await loadTasks();
}

function resetSaveBtn() {
  const saveBtn = document.getElementById('saveTaskBtn');
  saveBtn.disabled = false;
  saveBtn.textContent = 'حفظ المهمة';
}

async function markReviewed(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  const now = new Date();
  let update;

  if (task.review_mode === 'recurring') {
    const nextDue = new Date(now.getTime() + intervalMs(task));
    update = { last_reviewed_at: now.toISOString(), review_at: nextDue.toISOString() };
  } else {
    update = { last_reviewed_at: now.toISOString(), status: 'done' };
  }

  const { error } = await supabase.from('tasks').update(update).eq('id', id);
  if (error) {
    toast('حصل خطأ: ' + error.message, 'error');
    return;
  }
  toast('تم تسجيل المراجعة ✅', 'success');
  await loadTasks();
}

async function deleteTask(id) {
  if (!confirm('متأكد إنك عاوز تحذف المهمة دي؟')) return;
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) {
    toast('حصل خطأ أثناء الحذف: ' + error.message, 'error');
    return;
  }
  toast('تم حذف المهمة', 'success');
  await loadTasks();
}

async function logout() {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}

function restoreNotifyState() {
  updateNotifyLabel();
}

function updateNotifyLabel() {
  const label = document.getElementById('notifyLabel');
  if (!('Notification' in window)) {
    label.textContent = 'الإشعارات غير مدعومة';
    document.getElementById('notifyBtn').disabled = true;
    return;
  }
  if (Notification.permission === 'granted') {
    label.textContent = 'الإشعارات مفعّلة';
  } else if (Notification.permission === 'denied') {
    label.textContent = 'الإشعارات محظورة من المتصفح';
  } else {
    label.textContent = 'تفعيل الإشعارات';
  }
}

async function toggleNotifications() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    const perm = await Notification.requestPermission();
    updateNotifyLabel();
    if (perm === 'granted') {
      toast('تم تفعيل الإشعارات 🔔', 'success');
      new Notification('متابعة تنفيذ المهام', { body: 'هيوصلك تنبيه لما أي تاسك يستحق المراجعة' });
    }
  } else {
    updateNotifyLabel();
  }
}

function checkDueNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  tasks.forEach(t => {
    const status = computeStatus(t);
    if (status.key !== 'late') return;

    const key = `${t.id}:${t.review_at}`;
    if (notifiedKeys.has(key)) return;

    new Notification('⏰ تاسك مستحق للمراجعة', {
      body: `${t.employee_name} — ${t.task_description}`,
      tag: key,
    });

    notifiedKeys.add(key);
    localStorage.setItem('notifiedKeys', JSON.stringify([...notifiedKeys]));
  });
}

function toast(msg, type = 'default') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
 
