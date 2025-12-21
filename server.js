const fs = require('fs');
const express = require('express');
const WebSocket = require('ws');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const wiegine = require('fca-mafiya');

const app = express();
app.use(express.json());

const server = app.listen(3000, () => {
  console.log('Chat API running on port 3000');
});

const wss = new WebSocket.Server({ server });

const DB_FILE = './messages.json';
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');

/* ------------------ Helpers ------------------ */
const readMessages = () =>
  JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

const saveMessage = (msg) => {
  const messages = readMessages();
  messages.push(msg);
  fs.writeFileSync(DB_FILE, JSON.stringify(messages, null, 2));
};

/* ------------------ REST API ------------------ */

// Send message
app.post('/api/chat/send', (req, res) => {
  const { roomId, sender, text } = req.body;

  const message = {
    id: uuidv4(),
    roomId,
    sender,
    text,
    timestamp: Date.now()
  };

  saveMessage(message);

  // Broadcast to WebSocket clients
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });

  res.json({ success: true, message });
});

// Get chat history
app.get('/api/chat/:roomId', (req, res) => {
  const messages = readMessages()
    .filter(m => m.roomId === req.params.roomId);
  res.json(messages);
});

/* ------------------ WebSocket ------------------ */

wss.on('connection', ws => {
  ws.on('message', data => {
    const payload = JSON.parse(data.toString());

    const message = {
      id: uuidv4(),
      roomId: payload.roomId,
      sender: payload.sender,
      text: payload.text,
      timestamp: Date.now()
    };

    saveMessage(message);

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  });
});
async function aiReply(text) {
  const res = await axios.post('AI_API_URL', { prompt: text });
  return res.data.reply;
}
async function aiReply(text) {
  const res = await axios.post('AI_API_URL', { prompt: text });
  return res.data.reply;

}
