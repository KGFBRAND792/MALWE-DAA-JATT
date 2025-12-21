const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// 🔐 CONFIG
const PAGE_TOKEN = "YOUR_PAGE_ACCESS_TOKEN";
const VERIFY_TOKEN = "VERIFY_TOKEN_123";

// ✅ WEBHOOK VERIFICATION
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// 📩 RECEIVE MESSAGES (GROUP / MULTI-USER)
app.post("/webhook", async (req, res) => {
  const entry = req.body.entry?.[0];
  const messagingEvents = entry?.messaging || [];

  for (const event of messagingEvents) {
    const senderId = event.sender.id;

    // TEXT MESSAGE
    if (event.message?.text) {
      await sendText(senderId, `👋 Welcome!\nYou said: ${event.message.text}`);
      await sendButtons(senderId);
    }

    // BUTTON CLICK
    if (event.postback?.payload) {
      await handlePostback(senderId, event.postback.payload);
    }
  }

  res.sendStatus(200);
});

// ✉️ SEND TEXT
async function sendText(psid, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_TOKEN}`,
    {
      recipient: { id: psid },
      message: { text }
    }
  );
}

// 🔘 SEND BUTTONS
async function sendButtons(psid) {
  await axios.post(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_TOKEN}`,
    {
      recipient: { id: psid },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: "Choose an option:",
            buttons: [
              {
                type: "postback",
                title: "📢 Group Info",
                payload: "GROUP_INFO"
              },
              {
                type: "postback",
                title: "🧑‍💻 Admin",
                payload: "ADMIN"
              }
            ]
          }
        }
      }
    }
  );
}

// 📌 HANDLE POSTBACKS
async function handlePostback(psid, payload) {
  switch (payload) {
    case "GROUP_INFO":
      await sendText(psid, "📢 This is a Page group-style chat bot.");
      break;

    case "ADMIN":
      await sendText(psid, "🧑‍💻 Admin will contact you soon.");
      break;

    default:
      await sendText(psid, "❓ Unknown action");
  }
}

// 🚀 START SERVER
app.listen(3000, () => {
  console.log("✅ Facebook Group Chat Bot running on port 3000");
});
