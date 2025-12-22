/**
 * FULL CHAT API SERVER
 * Pages → Webhooks → Express → WebSocket Dashboard
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');

const app = express();
const server = http.createServer(app);

// =====================
// CONFIG
// =====================
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// page_id → PAGE_ACCESS_TOKEN
// Example:
// {
//   "123456789": "EAAG...",
//   "987654321": "EAAG..."
// }
const PAGE_TOKENS = {
  // "PAGE_ID": "PAGE_ACCESS_TOKEN"
};

// =====================
// MIDDLEWARE
// =====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================
// WEBSOCKET SERVER
// =====================
const wss = new WebSocket.Server({ server });

function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', ws => {
  console.log('🖥️ Dashboard connected');
  ws.send(JSON.stringify({ type: 'status', message: 'Connected to Chat API' }));
});

// =====================
// WEBHOOK VERIFICATION
// =====================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// =====================
// WEBHOOK RECEIVER
// =====================
app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const event = entry?.messaging?.[0];

    if (!event || !event.message || event.message.is_echo) {
      return res.sendStatus(200);
    }

    const pageId = entry.id;
    const senderId = event.sender.id;
    const text = event.message.text || '';

    const messageData = {
      type: 'message',
      page_id: pageId,
      sender_id: senderId,
      text,
      time: new Date().toISOString()
    };

    // Push to WebSocket dashboard
    broadcast(messageData);

    // Auto reply (optional)
    if (text) {
      await sendMessage(pageId, senderId, '✅ Message received');
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.sendStatus(500);
  }
});

// =====================
// SEND MESSAGE FUNCTION
// =====================
async function sendMessage(pageId, psid, text) {
  const token = PAGE_TOKENS[pageId];
  if (!token) return;

  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${token}`,
    {
      recipient: { id: psid },
      message: { text }
    }
  );
}

// =====================
// HEALTH CHECK
// =====================
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Chat API Server',
    uptime: process.uptime()
  });
});

// =====================
// START SERVER
// =====================
server.listen(PORT, () => {
  console.log(`🚀 Chat API running on port ${PORT}`);
});
PORT=3000
VERIFY_TOKEN=my_verify_token
User → Facebook Page
      → Webhook (/webhook)
      → Express Server
      → WebSocket Dashboard (real-time)
      → Optional Auto-Reply
      const ws = new WebSocket('ws://localhost:3000');

ws.onmessage = (event) => {
  console.log('Live message:', JSON.parse(event.data));

};
