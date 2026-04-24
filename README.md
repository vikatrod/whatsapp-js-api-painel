# WhatsApp Web API + Painel de Gerenciamento

API REST para integração com WhatsApp Web via [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), com painel web para gerenciamento da sessão, QR code, atualizações e envio de mensagens.

## Funcionalidades

- **API REST** para envio de mensagens e consulta de chats/contatos
- **Painel Web** com autenticação JWT para gerenciamento completo
- **QR Code** renderizado em tempo real no navegador
- **Atualização da biblioteca** via painel (`npm install whatsapp-web.js@latest`)
- **Limpeza de cache/sessão** (.wwebjs_auth, .wwebjs_cache)
- **Reinício do cliente** WhatsApp ou do serviço completo (PM2)
- **Envio de mensagens de teste** pelo painel
- **Compatível com PM2** para reinício automático do serviço

## Requisitos

- Node.js >= 16
- Google Chrome ou Chromium (necessário para o Puppeteer)
- PM2 (recomendado para produção)

## Instalação

```bash
git clone https://github.com/vikatrod/whatsapp-js-api-painel.git
cd whatsapp-js-api-painel
npm install
```

## Configuração

Copie e edite o arquivo `.env`:

```env
PORT=3000
ADMIN_USER=admin
ADMIN_PASS=admin123
JWT_SECRET=whatsapp-api-secret-change-me
```

> **Importante:** Altere `ADMIN_PASS` e `JWT_SECRET` antes de expor publicamente.

## Uso

### Iniciar com Node

```bash
node index.js
```

### Iniciar com PM2

```bash
pm2 start index.js --name whatsapp-bot
```

Acesse o painel em `http://localhost:3000`

### Primeira conexão

1. Acesse o painel e faça login
2. O QR code aparecerá automaticamente quando necessário
3. Escaneie com o WhatsApp do celular
4. Após autenticado, a sessão é salva e reconectada automaticamente

## Endpoints da API

### Públicos

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | Status do serviço (ready, state) |
| POST | `/api/auth/login` | Autenticação (retorna JWT) |
| GET/POST | `/enviar-mensagem` | Envio de mensagem (parâmetros: `id`, `mensagem`) |

### Protegidos (JWT)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/admin/status` | Status completo (estado, uptime, QR, perfil) |
| GET | `/api/admin/qr-image` | QR code atual como imagem PNG |
| GET | `/api/admin/qr` | QR code atual como string |
| GET | `/api/me` | Informações do perfil conectado |
| POST | `/api/admin/update-lib` | Atualiza whatsapp-web.js para a última versão |
| POST | `/api/admin/clear-cache` | Remove .wwebjs_auth e .wwebjs_cache |
| POST | `/api/admin/restart-client` | Reinicia apenas o cliente WhatsApp |
| POST | `/api/admin/restart-service` | Reinicia o processo (PM2 reinicia automaticamente) |
| POST | `/api/admin/test-send` | Envia mensagem de teste (body: `id`, `mensagem`) |

### Locais (apenas localhost)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/chats` | Lista todos os chats |
| GET | `/chats/detalhado` | Chats separados em contatos e grupos |
| GET | `/contatos` | Lista contatos com nome e número |

### Autenticação

Todos os endpoints protegidos exigem o header:

```
Authorization: Bearer <token>
```

O token é obtido via `POST /api/auth/login` com body:

```json
{ "username": "admin", "password": "admin123" }
```

Expira em 8 horas.

### Exemplo de envio de mensagem

```bash
# Via API pública
curl -X POST http://localhost:3000/enviar-mensagem \
  -H "Content-Type: application/json" \
  -d '{"id": "5511999999999", "mensagem": "Olá!"}'

# Via API protegida (painel)
curl -X POST http://localhost:3000/api/admin/test-send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"id": "5511999999999", "mensagem": "Teste"}'
```

O campo `id` aceita número de telefone (com código do país, sem +) ou ID completo do WhatsApp (ex: `5511999999999@c.us` ou `grupo@g.us`).

## Painel Web

O painel oferece:

- **Status** — estado da conexão, uptime, número conectado
- **QR Code** — imagem PNG atualizada em tempo real para escanear
- **Ações Administrativas** — atualizar lib, limpar cache, reiniciar cliente/serviço
- **Envio de Teste** — formulário para enviar mensagem rapidamente
- **Logs** — saída das ações administrativas em tempo real

## Estrutura do Projeto

```
whatsappjsapi/
├── .env                    # Variáveis de ambiente
├── .gitignore
├── package.json
├── index.js                # Backend (Express + WhatsApp Client)
├── public/
│   ├── login.html          # Tela de login
│   ├── index.html          # Painel principal
│   ├── css/
│   │   └── style.css       # Estilos (dark theme)
│   └── js/
│       └── app.js          # Frontend JavaScript
└── .wwebjs_auth/           # Sessão salva
```

## Solução de Problemas

| Problema | Solução |
|----------|---------|
| QR code não aparece | Clique em "Reiniciar Cliente" ou "Limpar Cache" |
| Sessão corrompida | "Limpar Cache" e escaneie o QR novamente |
| WhatsApp desconecta sozinho | O WhatsApp Web encerra sessões remotas. Reconecte pelo painel |
| Erro ao atualizar lib | "Reiniciar Serviço" após a atualização para aplicar |
| Puppeteer não encontra Chrome | Instale o Google Chrome ou sete `PUPPETEER_EXECUTABLE_PATH` |

## Licença

MIT