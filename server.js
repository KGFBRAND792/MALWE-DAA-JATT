const fs = require('fs');
const express = require('express');
const multer = require('multer');
const http = require('http');
const WebSocket = require('ws');
const login = require('fca-mafiya');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

let botRunning = false;
let stopFlag = false;

// Convert Raw Cookie String to AppState JSON
function parseRawCookie(cookieString) {
    return cookieString.split(';').map(item => {
        const parts = item.trim().split('=');
        const name = parts[0];
        const value = parts.slice(1).join('=');
        return {
            key: name,
            value: value,
            domain: "facebook.com",
            path: "/",
            hostOnly: false,
            creation: new Date().toISOString(),
            lastAccessed: new Date().toISOString()
        };
    });
}

function broadcast(msg) {
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify({ type: 'log', msg }));
        }
    });
}

// ================= UI PAGE =================
app.get('/', (req, res) => {
    res.send(
<!DOCTYPE html>
<html>
<head>
    <title>FB Multi-Message Sender</title>
    <style>
        body { background: #0e1621; color: #fff; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .container { width: 400px; background: #17212b; padding: 25px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        h2 { text-align: center; color: #5288c1; margin-top: 0; }
        input, button { width: 100%; padding: 12px; margin: 8px 0; border-radius: 6px; border: none; box-sizing: border-box; }
        input { background: #242f3d; color: #fff; border: 1px solid #333; }
        .start-btn { background: #5288c1; color: white; font-weight: bold; cursor: pointer; }
        .stop-btn { background: #e53935; color: white; cursor: pointer; margin-top: 5px; }
        .logs { height: 150px; background: #000; padding: 10px; border-radius: 5px; overflow-y: auto; font-size: 12px; color: #00ff00; margin-top: 15px; border: 1px solid #333; }
    </style>
</head>
<body>
    <div class="container">
        <h2>FB Messenger Bot</h2>
        <form id="botForm">
            <input type="text" name="cookie" placeholder="Paste Raw Cookie Here" required>
            <input type="text" name="chatId" placeholder="Target Chat ID / UID" required>
            <input type="number" name="delay" placeholder="Delay (ms) e.g. 3000" value="3000">
            <input type="file" name="messageFile" accept=".txt" required>
            <button type="submit" class="start-btn">START SENDING</button>
        </form>
        <button onclick="stopBot()" class="stop-btn">STOP BOT</button>
        <div class="logs" id="logBox"></div>
    </div>

    <script>
        const logBox = document.getElementById('logBox');
        const ws = new WebSocket('ws://' + location.host);
        
        ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            logBox.innerHTML += '<div>' + data.msg + '</div>';
            logBox.scrollTop = logBox.scrollHeight;
        };

        document.getElementById('botForm').onsubmit = async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            logBox.innerHTML = '<div>⏳ Initializing...</div>';
            await fetch('/start', { method: 'POST', body: fd });
        };

        function stopBot() {
            fetch('/stop');
        }
    </script>
</body>
</html>
    );
});

// ================= CORE LOGIC =================
app.post('/start', upload.single('messageFile'), async (req, res) => {
    if (botRunning) return res.send('Already running');
    const { cookie, chatId, delay } = req.body;
    
    try {
        const appState = parseRawCookie(cookie);
        const messages = fs.readFileSync(req.file.path, 'utf8').split('\n').filter(Boolean);
        fs.unlinkSync(req.file.path);

        botRunning = true;
        stopFlag = false;

        broadcast('🔑 Logging in with provided cookie...');

        login({ appState }, (err, api) => {
            if (err) {
                broadcast('❌ Login Failed: ' + JSON.stringify(err));
                botRunning = false;
                return;
            }

            api.setOptions({ listenEvents: false, selfListen: false });
            broadcast('✅ Login Success! Starting loop...');

            (async () => {
                for (let i = 0; i < messages.length; i++) {
                    if (stopFlag) break;

                    const msg = messages[i].trim();
                    
                    api.sendMessage(msg, chatId, (sendErr) => {
                        if (sendErr) {
                            broadcast(❌ Failed to send message ${i + 1});
                        } else {
                            broadcast(📤 [${i + 1}/${messages.length}] Sent: ${msg.substring(0, 20)}...);
                        }
                    });

                    // Add a slight random jitter to prevent detection
                    const jitter = Math.floor(Math.random() * 500);
                    await new Promise(r => setTimeout(r, parseInt(delay) + jitter));
                }

                broadcast('🏁 Finished all messages.');
                botRunning = false;
            })();
        });

        res.send('Started');
    } catch (err) {
        broadcast('❌ System Error: ' + err.message);
        botRunning = false;
        res.status(500).send('Error');
    }
});

app.get('/stop', (req, res) => {
    stopFlag = true;
    botRunning = false;
    broadcast('🛑 Bot stopped by user.');
    res.send('Stopped');
});

server.listen(3000, () => {
    console.log('Server started on http://localhost:3000');

});

