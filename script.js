const toggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');

if (toggle && nav) {
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}

const slides = Array.from(document.querySelectorAll('[data-slider] .slide'));
let current = 0;

if (slides.length > 1) {
  setInterval(() => {
    slides[current].classList.remove('active');
    current = (current + 1) % slides.length;
    slides[current].classList.add('active');
  }, 3500);
}

const apiBase = '';
function setToken(token) { localStorage.setItem('mk_token', token); }
function getToken() { return localStorage.getItem('mk_token'); }

async function postJson(url, body, token) {
  const res = await fetch(url, {
    method: 'POST', headers: Object.assign({'Content-Type':'application/json'}, token ? {'x-auth-token': token} : {}),
    body: JSON.stringify(body)
  });
  return res.json();
}

async function getJson(url, token) {
  const res = await fetch(url, { headers: token ? {'x-auth-token': token} : {} });
  return res.json();
}

const registerForm = document.getElementById('registerForm');
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('reg_username').value;
    const password = document.getElementById('reg_password').value;
    const name = document.getElementById('reg_name').value;
    const phone = document.getElementById('reg_phone').value;
    const res = await postJson('/api/register', {username, password, name, phone});
    if (res.token) { setToken(res.token); alert('Kayıt başarılı, giriş yapıldı'); showCustomerPanel(); loadMyMessages(); }
    else alert(res.error || 'Kayıt hatası');
  });
}

const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login_username').value;
    const password = document.getElementById('login_password').value;
    const res = await postJson('/api/login', {username, password});
    if (res.token) {
      setToken(res.token);
      alert('Giriş başarılı');
      if (res.role === 'customer') {
        if (location.pathname.endsWith('login.html')) location.href = 'index.html';
        else { showCustomerPanel(); loadMyMessages(); }
      } else {
        alert('Not a customer');
      }
    } else alert(res.error || 'Giriş hatası');
  });
}

const adminLogin = document.getElementById('adminLogin');
if (adminLogin) {
  adminLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('admin_username').value;
    const password = document.getElementById('admin_password').value;
    const res = await postJson('/api/login', {username, password});
    if (res.token && res.role === 'admin') {
      setToken(res.token);
      try { localStorage.setItem('mk_user', JSON.stringify({username: res.username, name: res.name})); } catch (e) {}
      alert('Admin girişi başarılı');
      if (location.pathname.endsWith('login.html')) location.href = 'admin_dashboard.html';
      else { showAdminPanel(); loadAllMessages(); }
    } else alert(res.error || 'Admin girisi başarısız');
  });
}

function showCustomerPanel() {
  const el = document.getElementById('customerPanel');
  if (el) el.style.display = 'block';
}
function showAdminPanel() {
  const el = document.getElementById('adminPanel');
  if (el) el.style.display = 'block';
}

const sendMessageBtn = document.getElementById('sendMessage');
if (sendMessageBtn) {
  sendMessageBtn.addEventListener('click', async () => {
    const content = document.getElementById('cust_message').value;
    const is_quote = document.getElementById('cust_is_quote').checked;
    const token = getToken();
    if (!token) return alert('Önce giriş yapın');
    const res = await postJson('/api/messages', {content, is_quote}, token);
    if (res.id) { alert('Mesaj gönderildi'); document.getElementById('cust_message').value = ''; loadMyMessages(); }
    else alert(res.error || 'Gönderilemedi');
  });
}

async function loadMyMessages() {
  const token = getToken();
  if (!token) return;
  const rows = await getJson('/api/my/messages', token);
  const container = document.getElementById('myMessages');
  if (!container) return;
  container.innerHTML = '';
  rows.forEach(m => {
    const el = document.createElement('div');
    el.className = 'message';
    el.innerHTML = `<div><small>${m.created_at}</small> <strong>${m.is_quote? '[Teklif]':''}</strong></div><div>${m.content}</div><div style="color:green">${m.reply? 'Cevap: '+m.reply : ''}</div>`;
    container.appendChild(el);
  });
}

async function loadAllMessages() {
  const token = getToken();
  if (!token) return;
  const rows = await getJson('/api/messages', token);
  const cont = document.getElementById('allMessages');
  if (!cont) return;
  cont.innerHTML = '';
  rows.forEach(m => {
    const el = document.createElement('div');
    el.className = 'message';
    const displayName = m.sender_name || m.user_username || m.name || 'Anon';
    const displayPhone = m.sender_phone || m.phone || '';
    el.innerHTML = `<div class="meta"><input type="checkbox" class="msg-check" data-id="${m.id}" /> <small>${m.created_at}</small> <strong>${displayName}</strong> ${displayPhone? ' - '+displayPhone : ''} ${m.is_quote? '<em>[Teklif]</em>':''}</div>
      <div class="content">${m.content}</div>
      <div style="color:green">${m.reply? 'Cevap: '+m.reply : ''}</div>`;
    if (!m.reply) {
      const replyWrap = document.createElement('div');
      replyWrap.className = 'reply-area';
      replyWrap.innerHTML = `<textarea data-id="${m.id}" placeholder="Cevap yazin"></textarea>
        <div style="display:flex;flex-direction:column;gap:8px;min-width:140px;">
          <button class="wa-btn" data-id="${m.id}" data-phone="${displayPhone}">WhatsApp ile Gönder</button>
          <button class="save-reply-btn" data-id="${m.id}">Cevabı Kaydet</button>
        </div>`;
      el.appendChild(replyWrap);
    } else {
      const repMeta = document.createElement('div'); repMeta.className='reply-meta'; repMeta.textContent = `Yanıtlandı: ${m.replied_at || ''}`; el.appendChild(repMeta);
    }
    cont.appendChild(el);
  });
  document.querySelectorAll('.wa-btn').forEach(btn => btn.addEventListener('click', (e) => {
    const id = btn.getAttribute('data-id');
    const phone = btn.getAttribute('data-phone') || '';
    const ta = document.querySelector(`textarea[data-id="${id}"]`);
    const text = ta ? ta.value : '';
    if (!phone) return alert('Telefon numarası bulunamadı');
    const digits = phone.replace(/[^0-9+]/g,'');
    let num = digits.replace(/^\+/, '');
    if (num.length === 10) num = '90' + num;
    const message = encodeURIComponent(text);
    const url = `https://wa.me/${num}?text=${message}`;
    window.open(url, '_blank');
  }));

  document.querySelectorAll('.save-reply-btn').forEach(btn => btn.addEventListener('click', async (e) => {
    const id = btn.getAttribute('data-id');
    const ta = document.querySelector(`textarea[data-id="${id}"]`);
    const reply = ta ? ta.value : '';
    if (!reply) return alert('Önce cevap yazın');
    const res = await postJson(`/api/messages/${id}/reply`, {reply}, getToken());
    if (res.updated) { alert('Cevap kaydedildi'); loadAllMessages(); }
    else alert(res.error || 'Hata');
  }));
  
  const deleteBtn = document.getElementById('deleteSelected');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const checks = Array.from(document.querySelectorAll('.msg-check:checked'));
      if (!checks.length) return alert('Önce mesaj seçin');
      const ids = checks.map(c => Number(c.getAttribute('data-id')));
      deleteBtn.disabled = true;
      try {
        const res = await postJson('/api/messages/delete', { ids }, getToken());
        if (res.deleted !== undefined) { location.reload(); }
        else alert(res.error || 'Silme hatası');
      } catch (e) { alert('Silme isteği başarısız'); }
      deleteBtn.disabled = false;
    });
  }
}

if (getToken()) {
  getJson('/api/messages', getToken()).then(r => { if (Array.isArray(r)) { showAdminPanel(); loadAllMessages(); } else { showCustomerPanel(); loadMyMessages(); } }).catch(()=>{ showCustomerPanel(); loadMyMessages(); });
}

const loginFormPage = document.getElementById('loginFormPage');
if (loginFormPage) {
}

const bottomSend = document.getElementById('bottomSend');
if (bottomSend) {
  bottomSend.addEventListener('click', async () => {
    const content = document.getElementById('bottom_message').value;
    const is_quote = document.getElementById('bottom_is_quote').checked;
    const token = getToken();
    if (!token) return alert('Mesaj gönderebilmek için giriş yapın.');
    const res = await postJson('/api/messages', {content, is_quote}, token);
    if (res.id) { alert('Mesaj gönderildi'); document.getElementById('bottom_message').value = ''; }
    else alert(res.error || 'Gönderilemedi');
  });
}

const contactForm = document.getElementById('contactForm');
if (contactForm) {
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('name').value;
    const phone = document.getElementById('phone').value;
    const content = document.getElementById('message').value;
    const res = await postJson('/api/messages/public', { name, phone, content, is_quote: false });
    if (res.id) { alert('Mesajınız alındı. Teşekkürler.'); contactForm.reset(); }
    else alert(res.error || 'Gönderilemedi');
  });
}
