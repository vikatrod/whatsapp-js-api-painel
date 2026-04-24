/* ================================
   FRONTEND APP - WhatsApp Manager
   ================================ */
const API_URL = window.location.origin;

// ── Auth ───────────────────────────
const token = localStorage.getItem('wajwt');
if (!token && !location.pathname.endsWith('/login.html')) {
  location.href = '/login.html';
}

// ── Elementos DOM ──────────────────
const els = {
  logoutBtn: document.getElementById('logoutBtn'),
  statusArea: document.getElementById('statusArea'),
  qrSection: document.getElementById('qrSection'),
  qrContainer: document.getElementById('qrContainer'),
  btnUpdateLib: document.getElementById('btnUpdateLib'),
  btnClearCache: document.getElementById('btnClearCache'),
  btnRestartClient: document.getElementById('btnRestartClient'),
  btnRestartService: document.getElementById('btnRestartService'),
  actionOutput: document.getElementById('actionOutput'),
  sendForm: document.getElementById('sendForm'),
  sendId: document.getElementById('sendId'),
  sendMsg: document.getElementById('sendMsg'),
  sendResult: document.getElementById('sendResult'),
};

// ── Helpers ────────────────────────
function logOutput(msg, type = 'info') {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  els.actionOutput.style.display = 'block';
  els.actionOutput.textContent += line;
  els.actionOutput.scrollTop = els.actionOutput.scrollHeight;
}

function clearOutput() {
  els.actionOutput.textContent = '';
  els.actionOutput.style.display = 'none';
}

async function api(path, opts = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(opts.headers || {}),
    },
    ...opts,
  });
  if (res.status === 401) {
    localStorage.removeItem('wajwt');
    location.href = '/login.html';
    return;
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { ok: res.ok, status: res.status, text, json };
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.textContent = loading ? '⏳ Aguarde...' : btn.dataset.originalText || btn.textContent;
}

[els.btnUpdateLib, els.btnClearCache, els.btnRestartClient, els.btnRestartService].forEach(btn => {
  if (btn) btn.dataset.originalText = btn.textContent;
});

// ── State ──────────────────────────
let lastQr = null;
let startTime = null;

// ── Status (sem QR, rapido) ────────
async function loadStatus() {
  const r = await api('/api/admin/status');
  if (!r || !r.ok) return;

  const data = r.json;
  const isConnected = data.ready && data.state === 'CONNECTED';
  startTime = data.startTime;

  const uptimeStr = startTime ? formatUptime(Math.floor((Date.now() - startTime) / 1000)) : '—';
  const stateClass = isConnected ? 'status-connected' : 'status-disconnected';
  const stateText = isConnected ? 'Conectado' : 'Desconectado';

  els.statusArea.innerHTML = `
    <div class="status-row">
      <div class="status-item">
        <span class="label">Estado</span>
        <span class="status-badge ${stateClass}">${stateText}</span>
      </div>
      <div class="status-item">
        <span class="label">Detalhe</span>
        <span>${data.state || 'UNKNOWN'}</span>
      </div>
      <div class="status-item">
        <span class="label">Uptime</span>
        <span>${uptimeStr}</span>
      </div>
      <div class="status-item">
        <span class="label">Número</span>
        <span>${data.me?.number || '—'}</span>
      </div>
    </div>
  `;

  if (!isConnected) {
    loadQr();
  } else {
    els.qrSection.style.display = 'none';
    lastQr = null;
  }

  if (data.updating) logOutput('Atualizando biblioteca...');
  else if (data.restarting) logOutput('Reiniciando cliente...');
}

// ── QR Code (imagem PNG do backend) ─
let qrImg = null;
let lastQrFetch = 0;

async function loadQr() {
  try {
    const res = await fetch(`${API_URL}/api/admin/qr-image`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) {
      els.qrSection.style.display = 'none';
      return;
    }

    const now = Date.now();
    if (now - lastQrFetch < 2000) return;
    lastQrFetch = now;

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    if (!qrImg) {
      qrImg = document.createElement('img');
      qrImg.style.maxWidth = '300px';
      qrImg.style.borderRadius = '8px';
      els.qrContainer.innerHTML = '';
      els.qrContainer.appendChild(qrImg);
    }

    if (qrImg._lastUrl) URL.revokeObjectURL(qrImg._lastUrl);
    qrImg._lastUrl = url;
    qrImg.src = url;
    els.qrSection.style.display = 'block';
    logOutput('QR Code atualizado. Escaneie no WhatsApp!');
  } catch (_) {
    els.qrSection.style.display = 'none';
  }
}

// ── Ações Administrativas ────────
els.btnUpdateLib.addEventListener('click', async () => {
  if (!confirm('Isso executará "npm install whatsapp-web.js@latest". Continuar?')) return;
  clearOutput();
  logOutput('Iniciando atualização da biblioteca...');
  setLoading(els.btnUpdateLib, true);
  const r = await api('/api/admin/update-lib', { method: 'POST' });
  setLoading(els.btnUpdateLib, false);
  if (r?.ok) {
    logOutput('Atualização iniciada. Acompanhe os logs do servidor.');
    alert('Biblioteca atualizada! Reinicie o serviço para aplicar.');
  } else {
    logOutput(`Erro: ${r?.json?.error || r?.text || 'Erro desconhecido'}`, 'error');
  }
});

els.btnClearCache.addEventListener('click', async () => {
  if (!confirm('Isso apagará a sessão salva e o cache. Você precisará escanear o QR Code novamente. Continuar?')) return;
  clearOutput();
  logOutput('Limpando cache e sessão...');
  setLoading(els.btnClearCache, true);
  const r = await api('/api/admin/clear-cache', { method: 'POST' });
  setLoading(els.btnClearCache, false);
  if (r?.ok) {
    logOutput('Cache e sessão limpos. Reinicie o serviço.', 'success');
  } else {
    logOutput(`Erro: ${r?.json?.error || r?.text || 'Erro desconhecido'}`, 'error');
  }
});

els.btnRestartClient.addEventListener('click', async () => {
  if (!confirm('Reiniciar apenas o cliente WhatsApp? O servidor continuará rodando.')) return;
  clearOutput();
  logOutput('Reiniciando cliente WhatsApp...');
  setLoading(els.btnRestartClient, true);
  const r = await api('/api/admin/restart-client', { method: 'POST' });
  setLoading(els.btnRestartClient, false);
  if (r?.ok) {
    logOutput('Cliente reiniciado. Aguardando conexão...', 'success');
  } else {
    logOutput(`Erro: ${r?.json?.error || r?.text || 'Erro desconhecido'}`, 'error');
  }
});

els.btnRestartService.addEventListener('click', async () => {
  if (!confirm('ISSO REINICIARÁ TODO O SERVIÇO. O PM2 fará o restart automaticamente. Continuar?')) return;
  clearOutput();
  logOutput('Reiniciando serviço completo...');
  setLoading(els.btnRestartService, true);
  const r = await api('/api/admin/restart-service', { method: 'POST' });
  if (r?.ok) {
    logOutput('Serviço reiniciando via PM2... Aguarde.', 'success');
    setTimeout(() => location.reload(), 12000);
  } else {
    setLoading(els.btnRestartService, false);
    logOutput(`Erro: ${r?.json?.error || r?.text || 'Erro desconhecido'}`, 'error');
  }
});

// ── Teste de Envio ───────────────
els.sendForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = els.sendId.value.trim();
  const mensagem = els.sendMsg.value.trim();
  if (!id || !mensagem) { alert('Preencha destinatário e mensagem.'); return; }

  const btn = els.sendForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  els.sendResult.style.display = 'none';
  logOutput(`Enviando mensagem de teste para ${id}...`);

  const r = await api('/api/admin/test-send', {
    method: 'POST',
    body: JSON.stringify({ id, mensagem }),
  });
  btn.disabled = false;
  if (r?.ok) {
    els.sendResult.textContent = `Enviado! ID: ${r.json.messageId}`;
    els.sendResult.style.display = 'block';
    logOutput(`Mensagem enviada! ID: ${r.json.messageId}`, 'success');
    els.sendMsg.value = '';
  } else {
    els.sendResult.textContent = `Erro: ${r?.json?.error || r?.text || 'Erro desconhecido'}`;
    els.sendResult.style.display = 'block';
    logOutput(`Erro ao enviar: ${r?.json?.error || r?.text || 'Erro desconhecido'}`, 'error');
  }
});

// ── Logout ───────────────────────
els.logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('wajwt');
  location.href = '/login.html';
});

// ── Inicialização ────────────────
logOutput('Painel carregado. Conectando ao servidor...');
loadStatus();
setInterval(loadStatus, 3000);
