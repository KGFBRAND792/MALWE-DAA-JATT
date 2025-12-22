import os, json
from flask import Flask, render_template, request
from fbchat import Client
from fbchat.models import Message, ThreadType

app = Flask(__name__)

COOKIE_DIR = "cookies"
UPLOAD_DIR = "uploads"

os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.route("/")
def index():
    cookies = os.listdir(COOKIE_DIR)
    return render_template("index.html", cookies=cookies)

@app.route("/send", methods=["POST"])
def send():
    cookie_file = request.form["cookie"]
    thread_id = request.form["thread_id"]
    text = request.form.get("message")

    with open(os.path.join(COOKIE_DIR, cookie_file)) as f:
        cookies = json.load(f)

    client = Client(cookies=cookies)

    if text:
        client.send(
            Message(text=text),
            thread_id=thread_id,
            thread_type=ThreadType.GROUP
        )

    file = request.files.get("file")
    if file and file.filename:
        path = os.path.join(UPLOAD_DIR, file.filename)
        file.save(path)

        client.sendLocalFiles(
            [path],
            message=Message(text="📎 File sent"),
            thread_id=thread_id,
            thread_type=ThreadType.GROUP
        )

    client.logout()
    return "✅ Message Sent Successfully"

if __name__ == "__main__":
    app.run(port=3000, debug=True)
    <!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>FB Group Multi Cookie Sender</title>
  <style>
    body { font-family: Arial; background:#f4f4f4; padding:40px; }
    .box { background:#fff; padding:20px; max-width:450px; margin:auto; border-radius:8px; }
    input, textarea, select, button {
      width:100%; padding:10px; margin-top:10px;
    }
    button {
      background:#1877f2; color:#fff; border:none; cursor:pointer;
    }
  </style>
</head>
<body>

<div class="box">
  <h3>📨 Facebook Group Sender</h3>

  <form action="/send" method="POST" enctype="multipart/form-data">

    <label>🍪 Select Account</label>
    <select name="cookie">
      {% for c in cookies %}
        <option value="{{ c }}">{{ c }}</option>
      {% endfor %}
    </select>

    <input type="text" name="thread_id" placeholder="Group Thread ID" required>

    <textarea name="message" placeholder="Message (optional)"></textarea>

    <label>📎 File (optional)</label>
    <input type="file" name="file">

    <button type="submit">Send Message</button>
  </form>
</div>

</body>
</html>
