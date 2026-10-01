const currency = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
});
const SUPABASE_URL = 'https://xrgclmhojwxlhpymsaxm.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_53ryJOgMG0794ZXU7s0o_A_UZyep5A4';

const state = {
  items: [],
  transactions: [],
  customers: [],
  catalogFilter: 'all',
  transactionFilter: 'all',
  catalogSearch: '',
  activeView: 'ringkasan',
  toastTimer: null
};

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const rupiah = (amount) => currency.format(Number(amount) || 0);

async function supabaseRequest(endpoint, options = {}) {
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
      ...options,
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
  } catch {
    throw new Error('Tidak dapat menghubungi Supabase. Periksa koneksi internet dan URL project.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || 'Permintaan tidak dapat diproses.');
  return payload;
}

async function api(path, options = {}) {
  const url = new URL(path, location.href);
  const routePath = path.startsWith('/') ? path.split('?')[0] : url.pathname;
  const method = options.method || 'GET';

  if (routePath === '/api/health') {
    await supabaseRequest('items?select=id&limit=1');
    return { configured: true };
  }

  if (routePath === '/api/items' && method === 'GET') {
    const type = url.searchParams.get('type');
    const filter = type ? `&type=eq.${encodeURIComponent(type)}` : '';
    return supabaseRequest(`items?select=*&order=type.asc,name.asc${filter}`);
  }

  if (routePath === '/api/items' && method === 'POST') {
    const body = JSON.parse(options.body || '{}');
    const item = {
      name: String(body.name || '').trim(),
      type: body.type,
      category: String(body.category || 'Umum').trim() || 'Umum',
      price: Number(body.price),
      stock: body.type === 'product' ? Math.max(0, Math.floor(Number(body.stock) || 0)) : 0,
      low_stock_threshold: body.type === 'product' ? Math.max(0, Math.floor(Number(body.lowStockThreshold) || 0)) : 0
    };
    const created = await supabaseRequest('items', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(item)
    });
    return created[0];
  }

  if (routePath === '/api/summary') {
    const [items, transactions] = await Promise.all([
      supabaseRequest('items?select=id,type,stock,low_stock_threshold'),
      supabaseRequest('transactions?select=id,kind,total,created_at&order=created_at.desc&limit=1000')
    ]);
    const now = new Date();
    const monthTransactions = transactions.filter((transaction) => {
      const date = new Date(transaction.created_at);
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    });
    return {
      productCount: items.filter((item) => item.type === 'product').length,
      serviceCount: items.filter((item) => item.type === 'service').length,
      lowStockCount: items.filter((item) => item.type === 'product' && item.stock <= item.low_stock_threshold).length,
      stockUnits: items.filter((item) => item.type === 'product').reduce((sum, item) => sum + item.stock, 0),
      monthlyRevenue: monthTransactions.reduce((sum, transaction) => sum + Number(transaction.total), 0),
      monthlyTransactionCount: monthTransactions.length
    };
  }

  if (routePath === '/api/customers') {
    return supabaseRequest('customers?select=id,name,phone,created_at&order=name.asc');
  }

  if (routePath === '/api/transactions' && method === 'GET') {
    return supabaseRequest('transactions?select=*,customer:customers(id,name,phone),transaction_details(id,quantity,unit_price,line_total,item:items(id,name,type))&order=created_at.desc&limit=100');
  }

  if (routePath === '/api/transactions' && method === 'POST') {
    const body = JSON.parse(options.body || '{}');
    return supabaseRequest('rpc/create_transaction', {
      method: 'POST',
      body: JSON.stringify({
        p_customer_name: body.customerName,
        p_customer_phone: body.customerPhone || null,
        p_kind: body.kind,
        p_items: body.items
      })
    });
  }

  throw new Error('Endpoint tidak ditemukan.');
}

function showToast(message, isError = false) {
  const toast = byId('toast');
  toast.textContent = message;
  toast.classList.toggle('is-error', isError);
  toast.classList.add('is-visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

function setConnection(configured, message = '') {
  const status = byId('connection-status');
  status.classList.toggle('is-online', configured);
  status.classList.toggle('is-offline', !configured);
  status.querySelector('span:last-child').textContent = configured ? 'Supabase aktif' : 'Belum terhubung';
  const error = byId('page-error');
  if (!configured) {
    error.hidden = false;
    error.innerHTML = `<strong>Belum dapat terhubung ke Supabase.</strong> ${escapeHtml(message || 'Pastikan backend aktif dan jalankan backend/schema.sql di Supabase SQL Editor.')}`;
  } else {
    error.hidden = true;
  }
}

function setView(view) {
  if (!['ringkasan', 'katalog', 'transaksi', 'pelanggan'].includes(view)) return;
  state.activeView = view;
  document.querySelectorAll('.view-panel').forEach((panel) => {
    const visible = panel.id === `view-${view}`;
    panel.hidden = !visible;
    panel.classList.toggle('is-visible', visible);
  });
  document.querySelectorAll('.nav-link').forEach((link) => {
    const active = link.dataset.view === view;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  byId('current-page').textContent = view.charAt(0).toUpperCase() + view.slice(1);
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
}

function renderSummary(summary) {
  byId('monthly-revenue').textContent = rupiah(summary.monthlyRevenue);
  byId('product-count').textContent = summary.productCount;
  byId('stock-units').textContent = summary.stockUnits;
  byId('low-stock-count').textContent = summary.lowStockCount;
  const count = Number(summary.monthlyTransactionCount) || 0;
  byId('monthly-transactions').textContent = count
    ? `${count} transaksi tercatat bulan ini`
    : 'Belum ada transaksi bulan ini';

  const lowStock = state.items.filter((item) => item.type === 'product' && item.stock <= item.low_stock_threshold);
  const body = byId('low-stock-table');
  if (!lowStock.length) {
    body.innerHTML = '<tr><td colspan="4"><div class="empty-state compact-empty"><span class="empty-icon">✓</span><strong>Stok aman semua</strong><span>Produk yang perlu restock akan muncul di sini.</span></div></td></tr>';
    return;
  }
  body.innerHTML = lowStock.slice(0, 5).map((item) => `
    <tr>
      <td><span class="item-name">${escapeHtml(item.name)}</span></td>
      <td>${escapeHtml(item.category)}</td>
      <td><strong class="stock-number ${item.stock === 0 ? 'is-zero' : ''}">${item.stock}</strong><span class="stock-unit"> unit</span></td>
      <td><span class="status-pill ${item.stock === 0 ? 'pill-empty' : 'pill-low'}">${item.stock === 0 ? 'Habis' : 'Menipis'}</span></td>
    </tr>`).join('');
}

function renderCatalog() {
  const query = state.catalogSearch.trim().toLocaleLowerCase('id');
  const filtered = state.items.filter((item) => {
    const matchesType = state.catalogFilter === 'all' || item.type === state.catalogFilter;
    const matchesText = !query || `${item.name} ${item.category}`.toLocaleLowerCase('id').includes(query);
    return matchesType && matchesText;
  });
  const body = byId('catalog-table');
  if (!filtered.length) {
    body.innerHTML = '<tr><td class="loading-cell" colspan="6">Belum ada item yang cocok.</td></tr>';
    return;
  }
  body.innerHTML = filtered.map((item) => {
    const isProduct = item.type === 'product';
    const status = !isProduct ? '<span class="status-pill pill-service">Aktif</span>'
      : item.stock === 0 ? '<span class="status-pill pill-empty">Habis</span>'
        : item.stock <= item.low_stock_threshold ? '<span class="status-pill pill-low">Menipis</span>'
          : '<span class="status-pill pill-good">Tersedia</span>';
    return `<tr>
      <td><span class="item-name">${escapeHtml(item.name)}</span></td>
      <td>${escapeHtml(item.category)}</td>
      <td><span class="type-label ${isProduct ? 'type-product' : 'type-service'}">${isProduct ? 'Produk' : 'Layanan'}</span></td>
      <td class="price-cell">${rupiah(item.price)}</td>
      <td>${isProduct ? `${item.stock} <span class="stock-unit">unit</span>` : '<span class="stock-unit">Tidak berlaku</span>'}</td>
      <td>${status}</td>
    </tr>`;
  }).join('');
}

function renderCustomers() {
  byId('customer-count').textContent = `${state.customers.length} pelanggan`;
  const table = byId('customers-table');
  const suggestions = byId('customer-options');
  if (!state.customers.length) {
    table.innerHTML = '<tr><td class="loading-cell" colspan="3">Belum ada pelanggan.</td></tr>';
    suggestions.replaceChildren();
    return;
  }
  table.innerHTML = state.customers.map((customer) => `
    <tr>
      <td><span class="item-name">${escapeHtml(customer.name)}</span></td>
      <td>${escapeHtml(customer.phone || 'Belum dicatat')}</td>
      <td>${formatDate(customer.created_at)}</td>
    </tr>`).join('');
  suggestions.innerHTML = state.customers.map((customer) => `<option value="${escapeHtml(customer.name)}"></option>`).join('');
}

function formatDate(value) {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function transactionKind(kind) {
  return kind === 'grooming'
    ? '<span class="type-label type-service">Grooming</span>'
    : '<span class="type-label type-product">Penjualan</span>';
}

function transactionDetail(transaction) {
  return (transaction.transaction_details || []).map((detail) =>
    `${escapeHtml(detail.item?.name || 'Item')} <span class="detail-quantity">× ${detail.quantity}</span>`
  ).join('<span class="detail-separator">, </span>');
}

function renderTransactions() {
  const transactions = state.transactions.filter((transaction) =>
    state.transactionFilter === 'all' || transaction.kind === state.transactionFilter
  );
  byId('transaction-count').textContent = `${transactions.length} transaksi`;
  const body = byId('transactions-table');
  if (!transactions.length) {
    body.innerHTML = '<tr><td class="loading-cell" colspan="5">Belum ada transaksi.</td></tr>';
    return;
  }
  body.innerHTML = transactions.map((transaction) => `<tr>
    <td><span class="date-cell">${formatDate(transaction.created_at)}</span></td>
    <td><span class="item-name">${escapeHtml(transaction.customer?.name || 'Pelanggan')}</span><span class="customer-phone">${escapeHtml(transaction.customer?.phone || '')}</span></td>
    <td class="detail-cell">${transactionDetail(transaction)}</td>
    <td>${transactionKind(transaction.kind)}</td>
    <td class="price-cell">${rupiah(transaction.total)}</td>
  </tr>`).join('');
}

function renderRecentTransactions() {
  const container = byId('recent-transactions');
  if (!state.transactions.length) {
    container.innerHTML = '<div class="empty-state"><span class="empty-icon">↗</span><strong>Belum ada aktivitas</strong><span>Transaksi baru akan muncul di sini.</span></div>';
    return;
  }
  container.innerHTML = state.transactions.slice(0, 4).map((transaction) => `
    <article class="activity-item">
      <span class="activity-icon ${transaction.kind === 'grooming' ? 'activity-grooming' : 'activity-sale'}" aria-hidden="true">${transaction.kind === 'grooming' ? '✳' : '↗'}</span>
      <div class="activity-copy"><strong>${escapeHtml(transaction.customer?.name || 'Pelanggan')}</strong><span>${transaction.kind === 'grooming' ? 'Layanan grooming' : 'Penjualan produk'} · ${formatDate(transaction.created_at)}</span></div>
      <strong class="activity-amount">${rupiah(transaction.total)}</strong>
    </article>`).join('');
}

async function loadData() {
  const [health, items, transactions, summary, customers] = await Promise.all([
    api('/api/health'),
    api('/api/items'),
    api('/api/transactions'),
    api('/api/summary'),
    api('/api/customers')
  ]);
  setConnection(health.configured);
  state.items = items;
  state.transactions = transactions;
  state.customers = customers;
  renderSummary(summary);
  renderCatalog();
  renderTransactions();
  renderRecentTransactions();
  renderCustomers();
}

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function syncItemFormType() {
  const service = byId('item-type').value === 'service';
  document.querySelector('.stock-fields').hidden = service;
}

function makeLineRow(items = state.items.filter((item) => item.type === byId('transaction-kind').value)) {
  const row = document.createElement('div');
  row.className = 'transaction-line';
  const options = items.map((item) => `<option value="${escapeHtml(item.id)}" data-price="${item.price}" data-stock="${item.stock}">${escapeHtml(item.name)} · ${rupiah(item.price)}${item.type === 'product' ? ` (stok ${item.stock})` : ''}</option>`).join('');
  row.innerHTML = `<select class="line-item-select" aria-label="Pilih item"><option value="">Pilih ${byId('transaction-kind').value === 'sale' ? 'produk' : 'layanan'}...</option>${options}</select><input class="line-quantity" aria-label="Jumlah" type="number" min="1" step="1" value="1"><button class="icon-button remove-line" type="button" aria-label="Hapus item" title="Hapus item"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16m-10 4v6m4-6v6M6.5 7l1 13h9l1-13M9 7V4h6v3"/></svg></button>`;
  row.querySelector('.line-item-select').addEventListener('change', updateTransactionTotal);
  row.querySelector('.line-quantity').addEventListener('input', updateTransactionTotal);
  row.querySelector('.remove-line').addEventListener('click', () => {
    row.remove();
    updateTransactionTotal();
  });
  return row;
}

function updateTransactionItems() {
  const kind = byId('transaction-kind').value;
  const available = state.items.filter((item) => item.type === (kind === 'sale' ? 'product' : 'service'));
  const lines = byId('transaction-lines');
  lines.replaceChildren();
  if (available.length) lines.append(makeLineRow(available));
  else lines.innerHTML = `<p class="inline-empty">${kind === 'sale' ? 'Belum ada produk di katalog.' : 'Belum ada layanan di katalog.'} <button class="text-button" type="button" data-add-catalog-item>Tambah ke katalog</button></p>`;
  lines.querySelector('[data-add-catalog-item]')?.addEventListener('click', () => {
    closeDialog(byId('transaction-dialog'));
    byId('item-type').value = kind === 'sale' ? 'product' : 'service';
    syncItemFormType();
    openDialog(byId('item-dialog'));
  });
  updateTransactionTotal();
}

function updateTransactionTotal() {
  let total = 0;
  document.querySelectorAll('.transaction-line').forEach((row) => {
    const select = row.querySelector('.line-item-select');
    const selected = select.options[select.selectedIndex];
    total += (Number(selected?.dataset.price) || 0) * (Math.max(1, Number(row.querySelector('.line-quantity').value) || 1));
  });
  byId('transaction-total').textContent = rupiah(total);
}

function openTransactionDialog() {
  byId('transaction-form').reset();
  byId('transaction-form-error').textContent = '';
  updateTransactionItems();
  openDialog(byId('transaction-dialog'));
}

async function saveItem(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const error = byId('item-form-error');
  error.textContent = '';
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  try {
    await api('/api/items', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(data.entries()))
    });
    closeDialog(byId('item-dialog'));
    form.reset();
    syncItemFormType();
    await loadData();
    showToast('Item berhasil ditambahkan.');
  } catch (problem) {
    error.textContent = problem.message;
  } finally {
    submitButton.disabled = false;
  }
}

async function saveTransaction(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = byId('transaction-form-error');
  error.textContent = '';
  const lines = [...document.querySelectorAll('.transaction-line')].map((row) => ({
    itemId: row.querySelector('.line-item-select').value,
    quantity: Number(row.querySelector('.line-quantity').value)
  })).filter((line) => line.itemId);
  if (!lines.length) {
    error.textContent = 'Pilih minimal satu item transaksi.';
    return;
  }
  const data = new FormData(form);
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  try {
    const result = await api('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        kind: data.get('kind'),
        customerName: data.get('customerName'),
        customerPhone: data.get('customerPhone'),
        items: lines
      })
    });
    closeDialog(byId('transaction-dialog'));
    await loadData();
    showToast(`Transaksi tersimpan · ${rupiah(result.total)}`);
  } catch (problem) {
    error.textContent = problem.message;
  } finally {
    submitButton.disabled = false;
  }
}

function setFilter(buttons, activeButton, selectedClass) {
  buttons.forEach((button) => {
    const selected = button === activeButton;
    button.classList.toggle(selectedClass, selected);
    button.setAttribute('aria-selected', String(selected));
  });
}

function bindEvents() {
  document.querySelectorAll('.nav-link').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    setView(link.dataset.view);
  }));
  document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.go)));
  document.querySelectorAll('[data-open-transaction]').forEach((button) => button.addEventListener('click', openTransactionDialog));
  byId('new-transaction-button').addEventListener('click', openTransactionDialog);
  byId('add-item-button').addEventListener('click', () => {
    byId('item-form').reset();
    byId('item-form-error').textContent = '';
    syncItemFormType();
    openDialog(byId('item-dialog'));
  });
  byId('item-type').addEventListener('change', syncItemFormType);
  byId('item-form').addEventListener('submit', saveItem);
  byId('transaction-form').addEventListener('submit', saveTransaction);
  byId('transaction-kind').addEventListener('change', updateTransactionItems);
  byId('add-line-button').addEventListener('click', () => {
    const available = state.items.filter((item) => item.type === (byId('transaction-kind').value === 'sale' ? 'product' : 'service'));
    if (available.length) byId('transaction-lines').append(makeLineRow(available));
    updateTransactionTotal();
  });
  document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => closeDialog(button.closest('dialog'))));
  document.querySelectorAll('.app-dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog(dialog);
  }));
  document.querySelectorAll('.filter-tab').forEach((button) => button.addEventListener('click', () => {
    state.catalogFilter = button.dataset.filter;
    setFilter([...document.querySelectorAll('.filter-tab')], button, 'is-selected');
    renderCatalog();
  }));
  document.querySelectorAll('.transaction-filter').forEach((button) => button.addEventListener('click', () => {
    state.transactionFilter = button.dataset.kindFilter;
    setFilter([...document.querySelectorAll('.transaction-filter')], button, 'is-selected');
    renderTransactions();
  }));
  byId('catalog-search').addEventListener('input', (event) => {
    state.catalogSearch = event.target.value;
    renderCatalog();
  });
  byId('refresh-button').addEventListener('click', async () => {
    try {
      await loadData();
      showToast('Data berhasil diperbarui.');
    } catch (error) {
      showToast(error.message, true);
    }
  });
  window.addEventListener('hashchange', () => setView(location.hash.slice(1)));
}

function initializeDate() {
  byId('today-date').textContent = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).format(new Date());
}

async function initialize() {
  initializeDate();
  bindEvents();
  const requestedView = location.hash.slice(1);
  setView(['ringkasan', 'katalog', 'transaksi', 'pelanggan'].includes(requestedView) ? requestedView : 'ringkasan');
  try {
    await loadData();
  } catch (error) {
    setConnection(false, error.message);
    byId('low-stock-table').innerHTML = `<tr><td class="loading-cell" colspan="4">${escapeHtml(error.message)}</td></tr>`;
    byId('catalog-table').innerHTML = `<tr><td class="loading-cell" colspan="6">${escapeHtml(error.message)}</td></tr>`;
    byId('transactions-table').innerHTML = `<tr><td class="loading-cell" colspan="5">${escapeHtml(error.message)}</td></tr>`;
    byId('customers-table').innerHTML = `<tr><td class="loading-cell" colspan="3">${escapeHtml(error.message)}</td></tr>`;
    byId('recent-transactions').innerHTML = `<p class="loading-cell">${escapeHtml(error.message)}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', initialize);
