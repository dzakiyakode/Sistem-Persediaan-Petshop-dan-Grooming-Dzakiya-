const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const FRONTEND_DIR = path.resolve(__dirname, '..', 'frontend');
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://xrgclmhojwxlhpymsaxm.supabase.co').replace(/\/$/, '');
const SUPABASE_API_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_53ryJOgMG0794ZXU7s0o_A_UZyep5A4';
const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_API_KEY);

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Ukuran data terlalu besar'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Format JSON tidak valid'));
      }
    });
    request.on('error', reject);
  });
}

async function supabaseRequest(endpoint, options = {}) {
  if (!SUPABASE_CONFIGURED) {
    const error = new Error('Atur kredensial Supabase pada backend.');
    error.status = 503;
    throw error;
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    ...options,
    headers: {
      apikey: SUPABASE_API_KEY,
      Authorization: `Bearer ${SUPABASE_API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { message: text };
  }
  if (!response.ok) {
    const error = new Error(payload?.message || 'Permintaan ke Supabase gagal.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function handleApi(request, response, url) {
  const { pathname, searchParams } = url;

  if (pathname === '/api/health' && request.method === 'GET') {
    return sendJson(response, 200, { configured: SUPABASE_CONFIGURED });
  }

  if (pathname === '/api/summary' && request.method === 'GET') {
    const [items, transactions] = await Promise.all([
      supabaseRequest('items?select=id,type,stock,low_stock_threshold'),
      supabaseRequest('transactions?select=id,kind,total,created_at&order=created_at.desc&limit=1000')
    ]);
    const now = new Date();
    const monthTransactions = transactions.filter((transaction) => {
      const date = new Date(transaction.created_at);
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    });
    return sendJson(response, 200, {
      productCount: items.filter((item) => item.type === 'product').length,
      serviceCount: items.filter((item) => item.type === 'service').length,
      lowStockCount: items.filter((item) => item.type === 'product' && item.stock <= item.low_stock_threshold).length,
      stockUnits: items.filter((item) => item.type === 'product').reduce((sum, item) => sum + item.stock, 0),
      monthlyRevenue: monthTransactions.reduce((sum, transaction) => sum + Number(transaction.total), 0),
      monthlyTransactionCount: monthTransactions.length
    });
  }

  if (pathname === '/api/items' && request.method === 'GET') {
    const type = searchParams.get('type');
    const filter = type ? `&type=eq.${encodeURIComponent(type)}` : '';
    const items = await supabaseRequest(`items?select=*&order=type.asc,name.asc${filter}`);
    return sendJson(response, 200, items);
  }

  if (pathname === '/api/items' && request.method === 'POST') {
    const body = await readBody(request);
    const name = String(body.name || '').trim();
    const type = body.type === 'service' ? 'service' : body.type === 'product' ? 'product' : '';
    const price = Number(body.price);
    if (!name || !type || !Number.isFinite(price) || price < 0) {
      return sendJson(response, 400, { message: 'Nama, jenis, dan harga item harus diisi dengan benar.' });
    }
    const item = {
      name,
      type,
      category: String(body.category || 'Umum').trim() || 'Umum',
      price,
      stock: type === 'product' ? Math.max(0, Math.floor(Number(body.stock) || 0)) : 0,
      low_stock_threshold: type === 'product' ? Math.max(0, Math.floor(Number(body.lowStockThreshold) || 0)) : 0
    };
    const created = await supabaseRequest('items', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(item)
    });
    return sendJson(response, 201, created[0]);
  }

  if (pathname === '/api/customers' && request.method === 'GET') {
    const customers = await supabaseRequest('customers?select=id,name,phone&order=name.asc');
    return sendJson(response, 200, customers);
  }

  if (pathname === '/api/transactions' && request.method === 'GET') {
    const transactions = await supabaseRequest(
      'transactions?select=*,customer:customers(id,name,phone),transaction_details(id,quantity,unit_price,line_total,item:items(id,name,type))&order=created_at.desc&limit=100'
    );
    return sendJson(response, 200, transactions);
  }

  if (pathname === '/api/transactions' && request.method === 'POST') {
    const body = await readBody(request);
    if (!['sale', 'grooming'].includes(body.kind) || !Array.isArray(body.items) || !body.items.length) {
      return sendJson(response, 400, { message: 'Jenis dan rincian transaksi wajib diisi.' });
    }
    const result = await supabaseRequest('rpc/create_transaction', {
      method: 'POST',
      body: JSON.stringify({
        p_customer_name: body.customerName,
        p_customer_phone: body.customerPhone || null,
        p_kind: body.kind,
        p_items: body.items
      })
    });
    return sendJson(response, 201, result);
  }

  return sendJson(response, 404, { message: 'Endpoint tidak ditemukan.' });
}

function serveFrontend(request, response, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const filePath = path.resolve(FRONTEND_DIR, `.${requestedPath}`);
  if (filePath !== FRONTEND_DIR && !filePath.startsWith(`${FRONTEND_DIR}${path.sep}`)) {
    response.writeHead(403);
    return response.end('Forbidden');
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return response.end('Halaman tidak ditemukan.');
    }
    const extension = path.extname(filePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.svg': 'image/svg+xml'
    };
    response.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream' });
    response.end(contents);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return sendJson(response, 405, { message: 'Metode tidak didukung.' });
    }
    serveFrontend(request, response, url.pathname);
  } catch (error) {
    sendJson(response, error.status || 500, { message: error.message || 'Terjadi kesalahan pada server.' });
  }
});

server.listen(PORT, () => {
  console.log(`Petshop dan Grooming Dzakiya berjalan di http://localhost:${PORT}`);
  if (!SUPABASE_CONFIGURED) {
    console.warn('Supabase belum dikonfigurasi. Isi SUPABASE_SECRET_KEY dengan secret/service-role key.');
  }
});
