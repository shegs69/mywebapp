(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const MAX_QTY = 100;

  const storage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
  };

  const state = {
    products: [],
    users: [],
    cart: storage.get('cart', {}),      // { [productId]: quantity }
    userId: storage.get('userId', null),
    search: '',
  };

  // ---- helpers -----------------------------------------------------------

  /** Build a DOM node. Children are appended as text, so values are never parsed as HTML. */
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') el.className = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (value !== false && value != null) el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child != null) el.append(child);
    return el;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, options);
    let data = null;
    if (response.status !== 204) {
      try { data = await response.json(); } catch { /* non-JSON body */ }
    }
    if (!response.ok) throw new Error((data && data.error) || `Request failed (${response.status})`);
    return data;
  }

  const jsonRequest = (method, body) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  function toast(message, type = '') {
    const el = h('div', { class: `toast ${type}`, role: 'status' }, message);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 4000);
  }

  const formatDate = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const cartCount = () => Object.values(state.cart).reduce((sum, qty) => sum + qty, 0);
  const saveCart = () => storage.set('cart', state.cart);
  const productById = (id) => state.products.find((p) => p.id === Number(id));

  // ---- navigation --------------------------------------------------------

  function showView(name) {
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === name));
    document.querySelectorAll('.view').forEach((view) => { view.hidden = view.id !== `view-${name}`; });
    if (name === 'orders') loadOrders();
  }

  // ---- products ----------------------------------------------------------

  async function loadProducts() {
    try {
      state.products = await api('/api/products');
    } catch (err) {
      $('#product-grid').replaceChildren(h('p', { class: 'empty error' }, `Could not load products: ${err.message}`));
      return;
    }
    // Drop cart lines for products that no longer exist.
    for (const id of Object.keys(state.cart)) if (!productById(id)) delete state.cart[id];
    saveCart();
    renderProducts();
    renderAdminProducts();
    renderCart();
  }

  function productMedia(product) {
    const placeholder = () => h('span', { class: 'initial' }, product.name.charAt(0).toUpperCase());
    const media = h('div', { class: 'media' });
    if (product.image_url) {
      media.append(h('img', {
        src: product.image_url,
        alt: product.name,
        loading: 'lazy',
        onerror: (e) => e.currentTarget.replaceWith(placeholder()),
      }));
    } else {
      media.append(placeholder());
    }
    return media;
  }

  function renderProducts() {
    const query = state.search.trim().toLowerCase();
    const matches = state.products.filter((p) =>
      !query || p.name.toLowerCase().includes(query) || (p.description || '').toLowerCase().includes(query));

    const grid = $('#product-grid');
    if (!matches.length) {
      grid.replaceChildren(h('p', { class: 'empty' }, state.products.length ? 'No products match your search.' : 'No products yet.'));
      return;
    }
    grid.replaceChildren(...matches.map((product) =>
      h('article', { class: 'card product' },
        productMedia(product),
        h('div', { class: 'product-body' },
          h('h3', {}, product.name),
          h('p', {}, product.description),
          h('div', { class: 'product-foot' },
            h('span', { class: 'price' }, money.format(product.price)),
            h('button', { class: 'btn primary', type: 'button', onclick: () => addToCart(product.id) }, 'Add to cart'))))));
  }

  function renderAdminProducts() {
    const body = $('#admin-products');
    if (!state.products.length) {
      body.replaceChildren(h('tr', {}, h('td', { colspan: 4, class: 'empty' }, 'No products.')));
      return;
    }
    body.replaceChildren(...state.products.map((product) =>
      h('tr', {},
        h('td', {}, String(product.id)),
        h('td', {}, product.name),
        h('td', { class: 'num' }, money.format(product.price)),
        h('td', { class: 'num' },
          h('button', { class: 'btn danger', type: 'button', onclick: () => deleteProduct(product) }, 'Delete')))));
  }

  async function deleteProduct(product) {
    if (!confirm(`Delete "${product.name}"?`)) return;
    try {
      await api(`/api/products/${product.id}`, { method: 'DELETE' });
      toast(`Deleted ${product.name}`, 'success');
      await loadProducts();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function createProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $('button[type=submit]', form);
    const data = new FormData(form);
    const image = data.get('image');
    submit.disabled = true;
    try {
      let imageUrl = null;
      if (image && image.size > 0) {
        const payload = new FormData();
        payload.append('file', image);
        const upload = await api('/api/upload', { method: 'POST', body: payload });
        imageUrl = `/api/uploads/${upload.filename}`;
      }
      await api('/api/products', jsonRequest('POST', {
        name: data.get('name'),
        price: Number(data.get('price')),
        description: data.get('description'),
        image_url: imageUrl,
      }));
      form.reset();
      toast('Product added', 'success');
      await loadProducts();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      submit.disabled = false;
    }
  }

  // ---- cart --------------------------------------------------------------

  function addToCart(id) {
    state.cart[id] = Math.min((state.cart[id] || 0) + 1, MAX_QTY);
    saveCart();
    renderCart();
    toast(`Added ${productById(id).name} to cart`);
  }

  function changeQty(id, delta) {
    const next = (state.cart[id] || 0) + delta;
    if (next <= 0) delete state.cart[id];
    else state.cart[id] = Math.min(next, MAX_QTY);
    saveCart();
    renderCart();
  }

  function renderCart() {
    const entries = Object.entries(state.cart).filter(([id]) => productById(id));
    $('#cart-count').textContent = String(cartCount());

    const total = entries.reduce((sum, [id, qty]) => sum + productById(id).price * qty, 0);
    $('#cart-total').textContent = money.format(total);
    $('#checkout-btn').disabled = entries.length === 0;

    const container = $('#cart-items');
    if (!entries.length) {
      container.replaceChildren(h('p', { class: 'empty' }, 'Your cart is empty.'));
      return;
    }
    container.replaceChildren(...entries.map(([id, qty]) => {
      const product = productById(id);
      return h('div', { class: 'cart-line' },
        h('div', { class: 'thumb' }, product.image_url
          ? h('img', { src: product.image_url, alt: '', onerror: (e) => e.currentTarget.remove() })
          : product.name.charAt(0).toUpperCase()),
        h('div', { class: 'info' },
          h('div', { class: 'name' }, product.name),
          h('div', { class: 'unit' }, `${money.format(product.price)} each`)),
        h('div', { class: 'qty' },
          h('button', { type: 'button', 'aria-label': 'Decrease quantity', onclick: () => changeQty(id, -1) }, '−'),
          h('span', {}, String(qty)),
          h('button', { type: 'button', 'aria-label': 'Increase quantity', onclick: () => changeQty(id, 1) }, '+')));
    }));
  }

  function setCartOpen(open) {
    $('#cart-drawer').classList.toggle('open', open);
    $('#cart-drawer').setAttribute('aria-hidden', String(!open));
    $('#backdrop').hidden = !open;
  }

  async function checkout() {
    if (!state.userId) {
      toast('Select or create a user first', 'error');
      openUserDialog();
      return;
    }
    const items = Object.entries(state.cart).map(([id, quantity]) => ({ product_id: Number(id), quantity }));
    const button = $('#checkout-btn');
    button.disabled = true;
    try {
      const result = await api('/api/orders', jsonRequest('POST', { user_id: state.userId, items }));
      state.cart = {};
      saveCart();
      renderCart();
      setCartOpen(false);
      toast(`Order #${result.order_id} placed — ${money.format(result.order.total)}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
    }
  }

  // ---- users -------------------------------------------------------------

  async function loadUsers() {
    try {
      state.users = await api('/api/users');
    } catch (err) {
      state.users = [];
      toast(`Could not load users: ${err.message}`, 'error');
    }
    if (!state.users.some((u) => u.id === state.userId)) {
      state.userId = state.users.length ? state.users[0].id : null;
      storage.set('userId', state.userId);
    }
    renderUsers();
  }

  function renderUsers() {
    const select = $('#user-select');
    if (!state.users.length) {
      select.replaceChildren(h('option', { value: '' }, 'No users'));
      return;
    }
    select.replaceChildren(...state.users.map((user) =>
      h('option', { value: user.id, selected: user.id === state.userId }, user.name)));
  }

  function openUserDialog() { $('#user-dialog').showModal(); }

  async function createUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const user = await api('/api/users', jsonRequest('POST', { name: data.get('name'), email: data.get('email') }));
      state.users.push(user);
      state.userId = user.id;
      storage.set('userId', user.id);
      renderUsers();
      form.reset();
      $('#user-dialog').close();
      toast(`Welcome, ${user.name}!`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---- orders ------------------------------------------------------------

  async function loadOrders() {
    const container = $('#orders-list');
    if (!state.userId) {
      container.replaceChildren(h('p', { class: 'empty' }, 'Select or create a user to see orders.'));
      return;
    }
    try {
      const orders = await api(`/api/orders?user_id=${encodeURIComponent(state.userId)}`);
      if (!orders.length) {
        container.replaceChildren(h('p', { class: 'empty' }, 'No orders yet. Go buy something!'));
        return;
      }
      container.replaceChildren(...orders.map((order) =>
        h('article', { class: 'card order' },
          h('div', { class: 'order-head' },
            h('div', {},
              h('h3', {}, `Order #${order.id}`),
              h('div', { class: 'order-meta' }, formatDate(order.created_at))),
            h('div', {},
              h('span', { class: 'status' }, order.status), ' ',
              h('strong', {}, money.format(order.total)))),
          h('ul', {}, order.items.map((item) =>
            h('li', {},
              h('span', {}, `${item.quantity} × ${item.product_name}`),
              h('span', {}, money.format(item.unit_price * item.quantity))))))));
    } catch (err) {
      container.replaceChildren(h('p', { class: 'empty error' }, `Could not load orders: ${err.message}`));
    }
  }

  // ---- service status ----------------------------------------------------

  async function refreshStatus() {
    let status = {};
    try { status = await api('/api/status'); } catch { /* leave pills grey */ }
    document.querySelectorAll('[data-service]').forEach((pill) => {
      const up = status[pill.dataset.service];
      pill.classList.toggle('up', up === true);
      pill.classList.toggle('down', up === false);
    });
  }

  // ---- wiring ------------------------------------------------------------

  function init() {
    document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));
    $('#search').addEventListener('input', (e) => { state.search = e.target.value; renderProducts(); });
    $('#user-select').addEventListener('change', (e) => {
      state.userId = Number(e.target.value) || null;
      storage.set('userId', state.userId);
      if (!$('#view-orders').hidden) loadOrders();
    });
    $('#new-user-btn').addEventListener('click', openUserDialog);
    $('#user-cancel').addEventListener('click', () => $('#user-dialog').close());
    $('#user-form').addEventListener('submit', createUser);
    $('#product-form').addEventListener('submit', createProduct);
    $('#cart-btn').addEventListener('click', () => setCartOpen(true));
    $('#cart-close').addEventListener('click', () => setCartOpen(false));
    $('#backdrop').addEventListener('click', () => setCartOpen(false));
    $('#checkout-btn').addEventListener('click', checkout);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setCartOpen(false); });

    renderCart();
    loadProducts();
    loadUsers();
    refreshStatus();
    setInterval(refreshStatus, 30000);
  }

  init();
})();
