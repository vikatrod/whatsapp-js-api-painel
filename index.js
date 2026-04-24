require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

/* =========================
   Config
========================= */
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const JWT_SECRET = process.env.JWT_SECRET || 'whatsapp-admin-secret-change-me';
const PORT = process.env.PORT || 3000;

/* =========================
   WhatsApp Client
========================= */
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});

const app = express();
app.use(express.json());
app.use(express.static('public'));

let isReady = false;
let currentQr = null;
let currentState = 'UNLAUNCHED';
let clientInfo = null;
let isUpdating = false;
let isRestarting = false;
const startTime = Date.now();

/* =========================
   REGISTRO SEGURO DE ROTAS (sem app._router)
========================= */
const ROUTES = [];
function registerRoute(method, path, ...handlers) {
  ROUTES.push(`${method.toUpperCase().padEnd(10)} ${path}`);
  app[method](path, ...handlers);
}
function listEndpoints() {
  console.log('\n📡 ENDPOINTS DISPONÍVEIS:');
  ROUTES.forEach(r => console.log('  -', r));
  console.log('');
}

/* =========================
   Eventos WhatsApp
========================= */
client.on('qr', (qr) => {
  currentQr = qr;
  currentState = 'UNPAIRED';
  console.log('🔑 QR Code gerado! Escaneie no WhatsApp');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  currentQr = null;
  currentState = 'AUTHENTICATED';
  console.log('✅ Autenticado');
});

client.on('ready', async () => {
  isReady = true;
  isRestarting = false;
  console.log('🤖 WhatsApp pronto!');

  try {
    const state = await client.getState();
    const me = await client.info;
    clientInfo = {
      wid: me.wid._serialized,
      number: me.wid.user,
      pushname: me.pushname,
      platform: me.platform,
    };
    console.log(`   Estado: ${state}`);
    console.log(`   Número: ${clientInfo.number}`);
  } catch (e) {
    console.log('⚠️ Erro ao obter info:', e.message);
  }

  // ✅ PATCH / PALIATIVO:
  // Evita crash do WhatsApp Web em sendSeen (markedUnread undefined)
  try {
    if (client?.pupPage) {
      await client.pupPage.evaluate(() => {
        if (window?.WWebJS?.sendSeen) {
          window.WWebJS.sendSeen = async () => {};
        }
      });
      console.log('🩹 Patch aplicado: WWebJS.sendSeen desativado (evita markedUnread)');
    } else {
      console.log('⚠️ pupPage não disponível ainda para aplicar patch sendSeen');
    }
  } catch (e) {
    console.log('⚠️ Falha ao aplicar patch sendSeen:', String(e?.message || e));
  }

  listEndpoints();
});

client.on('disconnected', (reason) => {
  isReady = false;
  clientInfo = null;
  console.error('⚠ Desconectado:', reason);
});

/* =========================
   Helpers
========================= */
async function waitUntilConnected(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const state = await client.getState();
      if (state === 'CONNECTED') return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

function isGroupId(s) {
  return String(s).endsWith('@g.us');
}

function onlyDigits(s) {
  return String(s).replace(/\D+/g, '');
}

async function resolveToJid(rawId) {
  const id = String(rawId).trim();
  if (isGroupId(id)) return id;

  const digits = onlyDigits(id.replace('@c.us', ''));
  if (!digits) return null;

  const numberId = await client.getNumberId(digits).catch(() => null);
  return numberId?._serialized || null;
}

/* =========================
   LOCAL ONLY MIDDLEWARE
========================= */
function isLocalRequest(req) {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket.remoteAddress;

  if (!ip) return false;

  if (ip === '::1') return true;
  if (ip === '127.0.0.1') return true;
  if (ip.startsWith('::ffff:127.')) return true;

  return false;
}

function localOnly(req, res, next) {
  if (!isLocalRequest(req)) {
    return res.status(403).json({
      error: 'Acesso permitido apenas a requisições locais'
    });
  }
  next();
}

/* =========================
   JWT MIDDLEWARE
========================= */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ error: 'Token necessário' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

/* =========================
   ENDPOINTS PÚBLICOS
========================= */

// Health (público)
registerRoute('get', '/health', async (_, res) => {
  const state = await client.getState().catch(() => 'UNKNOWN');
  res.json({ ok: true, ready: isReady, state });
});

// Auth Login (público)
registerRoute('post', '/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ user: username }, JWT_SECRET, { expiresIn: '8h' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Credenciais inválidas' });
});

// Enviar mensagem (público - mantém compatibilidade)
registerRoute('all', '/enviar-mensagem', async (req, res) => {
  if (!isReady) {
    const ok = await waitUntilConnected(10000);
    if (!ok) return res.status(503).send('WhatsApp inicializando');
  }

  const { id, mensagem } = req.method === 'GET' ? req.query : req.body;
  if (!id || !mensagem) return res.status(400).send('Parâmetros obrigatórios: id, mensagem');

  try {
    const jid = await resolveToJid(id);
    if (!jid) return res.status(404).send('Destino inválido');

    const msg = await client.sendMessage(jid, mensagem);
    res.send(`Mensagem enviada para ${jid} | id=${msg.id.id}`);
  } catch (err) {
    console.error('Erro /enviar-mensagem:', err);
    res.status(500).send(`Erro ao enviar mensagem: ${err?.message || err}`);
  }
});

/* =========================
   ENDPOINTS PROTEGIDOS (LOCAL + JWT)
========================= */

// Status completo do admin
registerRoute('get', '/api/admin/status', requireAuth, async (_, res) => {
  let state = currentState;
  if (isReady) {
    state = await client.getState().catch(() => currentState);
    currentState = state;
  }
  res.json({
    ready: isReady,
    state,
    startTime,
    updating: isUpdating,
    restarting: isRestarting,
    qr: currentQr,
    me: clientInfo,
  });
});

// QR Code atual (JSON)
registerRoute('get', '/api/admin/qr', requireAuth, async (_, res) => {
  if (!currentQr) {
    return res.status(404).json({ error: 'Nenhum QR code disponível no momento' });
  }
  res.json({ qr: currentQr });
});

// QR Code como imagem PNG
registerRoute('get', '/api/admin/qr-image', requireAuth, async (_, res) => {
  if (!currentQr) {
    return res.status(404).send('Nenhum QR code disponível');
  }
  try {
    const url = await QRCode.toDataURL(currentQr, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'L',
    });
    const base64 = url.replace(/^data:image\/png;base64,/, '');
    const img = Buffer.from(base64, 'base64');
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': img.length });
    res.end(img);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao gerar imagem QR' });
  }
});

// Info do perfil logado
registerRoute('get', '/api/me', requireAuth, async (_, res) => {
  if (!isReady) return res.status(503).json({ error: 'WhatsApp não está pronto' });
  try {
    const me = await client.info;
    res.json({
      wid: me.wid._serialized,
      number: me.wid.user,
      pushname: me.pushname,
      platform: me.platform,
    });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao obter informações', details: String(err?.message || err) });
  }
});

// Atualizar whatsapp-web.js
registerRoute('post', '/api/admin/update-lib', requireAuth, async (_, res) => {
  if (isUpdating) return res.status(409).json({ error: 'Atualização já em andamento' });
  isUpdating = true;
  console.log('📦 Iniciando atualização da biblioteca...');

  exec('npm install whatsapp-web.js@latest --save', { timeout: 120000 }, (error, stdout, stderr) => {
    isUpdating = false;
    const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
    if (error) {
      console.error('❌ Erro ao atualizar:', error.message);
      return;
    }
    console.log('✅ Biblioteca atualizada!');
  });

  res.json({ message: 'Atualização iniciada. Acompanhe os logs do servidor.' });
});

// Limpar cache / sessão
registerRoute('post', '/api/admin/clear-cache', requireAuth, async (_, res) => {
  try {
    const cacheDir = path.join(process.cwd(), '.wwebjs_cache');
    const authDir = path.join(process.cwd(), '.wwebjs_auth');

    let deleted = [];

    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      deleted.push('.wwebjs_cache');
    }

    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
      deleted.push('.wwebjs_auth');
    }

    currentQr = null;
    isReady = false;
    clientInfo = null;

    console.log('🧹 Cache limpo:', deleted.join(', '));
    res.json({ message: 'Cache e sessão limpos', deleted, note: 'Reinicie o serviço para reconectar' });
  } catch (err) {
    console.error('Erro ao limpar cache:', err);
    res.status(500).json({ error: 'Falha ao limpar cache', details: String(err?.message || err) });
  }
});

// Reiniciar apenas o cliente WhatsApp
registerRoute('post', '/api/admin/restart-client', requireAuth, async (_, res) => {
  if (isRestarting) return res.status(409).json({ error: 'Reinício já em andamento' });
  isRestarting = true;
  isReady = false;
  currentQr = null;
  clientInfo = null;

  console.log('♻️ Reiniciando cliente WhatsApp...');

  try {
    await client.destroy();
  } catch (e) {
    console.log('⚠️ Erro ao destruir cliente:', e.message);
  }

  // Aguarda um pouco e reinicializa
  setTimeout(() => {
    client.initialize().catch(err => {
      console.error('❌ Erro ao reinicializar cliente:', err.message);
      isRestarting = false;
    });
  }, 2000);

  res.json({ message: 'Cliente WhatsApp reiniciando. Aguarde o QR code ou conexão.' });
});

// Reiniciar o serviço completo (PM2 irá reiniciar)
registerRoute('post', '/api/admin/restart-service', requireAuth, async (_, res) => {
  console.log('🔁 Reiniciando serviço completo (PM2)...');
  res.json({ message: 'Serviço reiniciando. O PM2 fará o restart automaticamente.' });

  // Pequeno delay para responder antes de sair
  setTimeout(() => {
    process.exit(0);
  }, 500);
});

// Teste de envio de mensagem
registerRoute('post', '/api/admin/test-send', requireAuth, async (req, res) => {
  if (!isReady) {
    const ok = await waitUntilConnected(10000);
    if (!ok) return res.status(503).json({ error: 'WhatsApp não está conectado' });
  }

  const { id, mensagem } = req.body || {};
  if (!id || !mensagem) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios: id, mensagem' });
  }

  try {
    const jid = await resolveToJid(id);
    if (!jid) return res.status(404).json({ error: 'Destino inválido' });

    const msg = await client.sendMessage(jid, mensagem);
    res.json({
      success: true,
      messageId: msg.id.id,
      to: jid,
      timestamp: msg.timestamp,
    });
  } catch (err) {
    console.error('Erro /api/admin/test-send:', err);
    res.status(500).json({ error: 'Erro ao enviar mensagem', details: String(err?.message || err) });
  }
});

/* =========================
   ENDPOINTS LOCAIS EXISTENTES
========================= */

// 🔒 Todos os chats (LOCAL ONLY)
registerRoute('get', '/chats', localOnly, async (_, res) => {
  if (!isReady) return res.status(503).json({ error: 'WhatsApp não está pronto' });

  try {
    const chats = await client.getChats();

    const result = chats.map(chat => ({
      id: chat.id._serialized,
      nome: chat.name || chat.pushname || null,
      tipo: chat.isGroup ? 'grupo' : 'contato'
    }));

    res.json({ total: result.length, chats: result });
  } catch (err) {
    console.error('Erro /chats:', err);
    res.status(500).json({ error: 'Falha ao listar chats', details: String(err?.message || err) });
  }
});

// 🔒 Chats separados (LOCAL ONLY)
registerRoute('get', '/chats/detalhado', localOnly, async (_, res) => {
  if (!isReady) return res.status(503).json({ error: 'WhatsApp não está pronto' });

  try {
    const chats = await client.getChats();
    const contatos = [];
    const grupos = [];

    for (const chat of chats) {
      const data = { id: chat.id._serialized, nome: chat.name || chat.pushname || null };
      if (chat.isGroup) grupos.push(data);
      else contatos.push(data);
    }

    res.json({ total: chats.length, contatos, grupos });
  } catch (err) {
    console.error('Erro /chats/detalhado:', err);
    res.status(500).json({ error: 'Falha ao listar chats detalhado', details: String(err?.message || err) });
  }
});

// 🔒 Somente contatos (LOCAL ONLY)
registerRoute('get', '/contatos', localOnly, async (_, res) => {
  if (!isReady) return res.status(503).json({ error: 'WhatsApp não está pronto' });

  try {
    const contatos = await client.getContacts();

    const result = contatos.map(c => {
      const nome = c.name || c.pushname || null;
      return {
        id: c.id?._serialized || null,
        nome,
        numero: c.number || null,
        isMyContact: Boolean(nome)
      };
    });

    res.json({ total: result.length, contatos: result });
  } catch (err) {
    console.error('Erro /contatos:', err);
    res.status(500).json({ error: 'Falha ao listar contatos', details: String(err?.message || err) });
  }
});

/* =========================
   HTTP SERVER
========================= */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP OK em http://localhost:${PORT}`);
});

/* =========================
   Inicializa WhatsApp
========================= */
client.initialize();
