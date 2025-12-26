import time
import os
import json
import random
import re
from datetime import datetime
from threading import Thread
from flask import Flask, request, render_template_string, jsonify
import requests
from urllib.parse import urlencode

app = Flask(__name__)
app.secret_key = os.urandom(24)

@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

sent_messages_log = []
is_sending = False
current_thread = None
login_error_message = ""
fb_session = None
message_count = 0

def get_random_color():
    colors = [
        '#ff0080', '#00ff80', '#8000ff', '#ff8000', '#0080ff', 
        '#80ff00', '#ff0040', '#40ff00', '#0040ff', '#ff4000',
        '#00ff40', '#4000ff', '#ff00c0', '#c0ff00', '#00c0ff',
        '#c000ff', '#ffc000', '#00ffc0', '#ff0060', '#60ff00',
        '#0060ff', '#6000ff', '#ff6000', '#00ff60', '#ff00a0',
        '#a0ff00', '#00a0ff', '#a000ff', '#ffa000', '#00ffa0'
    ]
    return random.choice(colors)

def get_random_gradient():
    gradients = [
        'linear-gradient(135deg, #ff0080, #7928ca)',
        'linear-gradient(135deg, #00ff87, #60efff)',
        'linear-gradient(135deg, #f093fb, #f5576c)',
        'linear-gradient(135deg, #4facfe, #00f2fe)',
        'linear-gradient(135deg, #43e97b, #38f9d7)',
        'linear-gradient(135deg, #fa709a, #fee140)',
        'linear-gradient(135deg, #667eea, #764ba2)',
        'linear-gradient(135deg, #f77062, #fe5196)',
        'linear-gradient(135deg, #30cfd0, #330867)',
        'linear-gradient(135deg, #a8edea, #fed6e3)',
        'linear-gradient(135deg, #ff9a9e, #fecfef)',
        'linear-gradient(135deg, #ffecd2, #fcb69f)',
        'linear-gradient(135deg, #a1c4fd, #c2e9fb)',
        'linear-gradient(135deg, #d299c2, #fef9d7)',
        'linear-gradient(135deg, #89f7fe, #66a6ff)',
    ]
    return random.choice(gradients)

def create_session_with_cookies(cookies_str):
    """Create a session with the provided cookies"""
    global login_error_message
    try:
        session = requests.Session()
        cookies_dict = {}
        
        for item in cookies_str.split(';'):
            item = item.strip()
            if '=' in item:
                key, value = item.split('=', 1)
                cookies_dict[key.strip()] = value.strip()
        
        for key, value in cookies_dict.items():
            session.cookies.set(key, value, domain='.facebook.com')
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        }
        session.headers.update(headers)
        
        response = session.get('https://mbasic.facebook.com/', timeout=30)
        
        if 'c_user' in session.cookies.get_dict() or 'c_user' in cookies_dict:
            return session
        else:
            if 'login' in response.url.lower() or 'checkpoint' in response.url.lower():
                login_error_message = "Session expired or account checkpoint"
                return None
            return session
    except Exception as e:
        login_error_message = str(e)
        return None

def create_session_with_token(access_token):
    """Create a session with access token for Graph API"""
    global login_error_message
    try:
        session = requests.Session()
        headers = {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.5',
        }
        session.headers.update(headers)
        session.access_token = access_token
        
        response = session.get(f'https://graph.facebook.com/me?access_token={access_token}', timeout=30)
        if response.status_code == 200:
            return session
        else:
            login_error_message = "Invalid access token"
            return None
    except Exception as e:
        login_error_message = str(e)
        return None

def send_message_mbasic(session, target_id, message, message_type):
    """Send message using mbasic.facebook.com - most reliable method"""
    try:
        if message_type == 'inbox':
            msg_url = f'https://mbasic.facebook.com/messages/thread/{target_id}/'
        else:
            msg_url = f'https://mbasic.facebook.com/messages/thread/{target_id}/'
        
        response = session.get(msg_url, timeout=30)
        
        if response.status_code != 200:
            return False, f"Failed to open chat: HTTP {response.status_code}"
        
        html = response.text
        
        if 'login' in response.url.lower():
            return False, "Session expired - please update cookies"
        
        fb_dtsg = None
        dtsg_patterns = [
            r'name="fb_dtsg" value="([^"]+)"',
            r'"fb_dtsg":"([^"]+)"',
            r'fb_dtsg=([^&"]+)',
        ]
        for pattern in dtsg_patterns:
            match = re.search(pattern, html)
            if match:
                fb_dtsg = match.group(1)
                break
        
        jazoest = None
        jazoest_match = re.search(r'name="jazoest" value="(\d+)"', html)
        if jazoest_match:
            jazoest = jazoest_match.group(1)
        
        form_action = None
        action_patterns = [
            r'action="(/messages/send/[^"]+)"',
            r'action="(https://mbasic\.facebook\.com/messages/send/[^"]+)"',
        ]
        for pattern in action_patterns:
            match = re.search(pattern, html)
            if match:
                form_action = match.group(1)
                if not form_action.startswith('http'):
                    form_action = 'https://mbasic.facebook.com' + form_action
                break
        
        if not form_action:
            form_action = f'https://mbasic.facebook.com/messages/send/?thread_id={target_id}&icm=1'
        
        data = {
            'body': message,
            'send': 'Send',
        }
        
        if fb_dtsg:
            data['fb_dtsg'] = fb_dtsg
        if jazoest:
            data['jazoest'] = jazoest
        
        headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': 'https://mbasic.facebook.com',
            'Referer': msg_url,
        }
        
        send_response = session.post(form_action, data=data, headers=headers, timeout=30, allow_redirects=True)
        
        if send_response.status_code == 200:
            if 'messages/thread' in send_response.url or 'messages/read' in send_response.url:
                return True, "Message sent successfully"
            elif 'login' in send_response.url.lower():
                return False, "Session expired"
            elif 'checkpoint' in send_response.url.lower():
                return False, "Account checkpoint required"
            else:
                return True, "Message likely sent"
        else:
            return False, f"HTTP {send_response.status_code}"
            
    except requests.exceptions.Timeout:
        return False, "Request timeout"
    except Exception as e:
        return False, str(e)

def send_message_graph_api(session, target_id, message, message_type):
    """Send message using Facebook Graph API with access token"""
    try:
        if not hasattr(session, 'access_token'):
            return False, "No access token available"
        
        url = f'https://graph.facebook.com/v18.0/{target_id}/messages'
        
        data = {
            'message': message,
            'access_token': session.access_token
        }
        
        response = session.post(url, data=data, timeout=30)
        
        if response.status_code == 200:
            return True, "Message sent via Graph API"
        else:
            error_data = response.json() if response.text else {}
            error_msg = error_data.get('error', {}).get('message', f'HTTP {response.status_code}')
            return False, error_msg
            
    except Exception as e:
        return False, str(e)

def send_single_message(session, target_id, message, message_type):
    """Try multiple methods to send message"""
    
    if hasattr(session, 'access_token'):
        success, msg = send_message_graph_api(session, target_id, message, message_type)
        if success:
            return success, msg
    
    return send_message_mbasic(session, target_id, message, message_type)

def send_facebook_message(session, target_id, hater_name, messages, delay, message_type):
    global is_sending, sent_messages_log, message_count
    try:
        index = 0
        while is_sending:
            if hater_name:
                full_message = f"{hater_name} {messages[index]}"
            else:
                full_message = messages[index]
            
            current_time = datetime.now().strftime("%H:%M:%S")
            
            success, error_msg = send_single_message(session, target_id, full_message, message_type)
            
            message_count += 1
            
            if success:
                sent_messages_log.append({
                    'message': full_message,
                    'time': current_time,
                    'status': 'Sent',
                    'color': get_random_color(),
                    'gradient': get_random_gradient(),
                    'count': message_count
                })
            else:
                sent_messages_log.append({
                    'message': f"{full_message[:50]}... - {error_msg}",
                    'time': current_time,
                    'status': 'Failed',
                    'color': '#ff0000',
                    'gradient': 'linear-gradient(135deg, #ff0000, #cc0000)',
                    'count': message_count
                })
            
            if len(sent_messages_log) > 100:
                sent_messages_log = sent_messages_log[-100:]
            
            time.sleep(delay)
            index = (index + 1) % len(messages)
    except Exception as e:
        sent_messages_log.append({
            'message': f"Error: {str(e)}",
            'time': datetime.now().strftime("%H:%M:%S"),
            'status': 'Failed',
            'color': '#ff0000',
            'gradient': 'linear-gradient(135deg, #ff0000, #cc0000)',
            'count': 0
        })

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Facebook Inbox Automation - Ultra Premium</title>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&family=Rajdhani:wght@300;400;500;600;700&family=Exo+2:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    <style>
        :root {
            --primary: #1877f2;
            --neon-cyan: #00f7ff;
            --neon-pink: #ff00d4;
            --neon-green: #00ff88;
            --neon-orange: #ff6600;
            --neon-purple: #aa00ff;
            --neon-yellow: #ffee00;
            --neon-red: #ff0044;
            --dark-bg: #050510;
            --card-bg: rgba(8, 8, 20, 0.95);
        }
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Exo 2', sans-serif;
            background: var(--dark-bg);
            min-height: 100vh;
            color: #fff;
            overflow-x: hidden;
        }
        
        .cosmic-bg {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 0;
            background: 
                radial-gradient(ellipse at 20% 20%, rgba(24, 119, 242, 0.2) 0%, transparent 40%),
                radial-gradient(ellipse at 80% 30%, rgba(255, 0, 212, 0.15) 0%, transparent 40%),
                radial-gradient(ellipse at 40% 80%, rgba(0, 255, 136, 0.12) 0%, transparent 40%),
                radial-gradient(ellipse at 90% 90%, rgba(170, 0, 255, 0.15) 0%, transparent 40%),
                radial-gradient(ellipse at 10% 70%, rgba(255, 102, 0, 0.12) 0%, transparent 40%);
            animation: cosmicShift 20s ease-in-out infinite;
        }
        
        @keyframes cosmicShift {
            0%, 100% { filter: hue-rotate(0deg) brightness(1); }
            25% { filter: hue-rotate(30deg) brightness(1.1); }
            50% { filter: hue-rotate(60deg) brightness(1); }
            75% { filter: hue-rotate(30deg) brightness(1.1); }
        }
        
        .stars {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 0;
        }
        
        .star {
            position: absolute;
            width: 3px;
            height: 3px;
            background: #fff;
            border-radius: 50%;
            animation: twinkle 3s ease-in-out infinite;
            box-shadow: 0 0 10px #fff, 0 0 20px currentColor;
        }
        
        @keyframes twinkle {
            0%, 100% { opacity: 0.3; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.5); }
        }
        
        .meteors {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 0;
            overflow: hidden;
        }
        
        .meteor {
            position: absolute;
            width: 100px;
            height: 2px;
            background: linear-gradient(90deg, transparent, #fff, #00f7ff);
            border-radius: 50%;
            animation: meteorShoot 4s linear infinite;
            transform: rotate(-45deg);
        }
        
        @keyframes meteorShoot {
            0% { top: -10%; left: 110%; opacity: 1; }
            70% { opacity: 1; }
            100% { top: 110%; left: -10%; opacity: 0; }
        }
        
        .hex-grid {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: 
                linear-gradient(30deg, rgba(24, 119, 242, 0.03) 12%, transparent 12.5%, transparent 87%, rgba(24, 119, 242, 0.03) 87.5%, rgba(24, 119, 242, 0.03)),
                linear-gradient(150deg, rgba(24, 119, 242, 0.03) 12%, transparent 12.5%, transparent 87%, rgba(24, 119, 242, 0.03) 87.5%, rgba(24, 119, 242, 0.03)),
                linear-gradient(30deg, rgba(24, 119, 242, 0.03) 12%, transparent 12.5%, transparent 87%, rgba(24, 119, 242, 0.03) 87.5%, rgba(24, 119, 242, 0.03)),
                linear-gradient(150deg, rgba(24, 119, 242, 0.03) 12%, transparent 12.5%, transparent 87%, rgba(24, 119, 242, 0.03) 87.5%, rgba(24, 119, 242, 0.03));
            background-size: 80px 140px;
            z-index: 0;
        }
        
        .main-container {
            position: relative;
            z-index: 10;
            min-height: 100vh;
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding: 30px;
        }
        
        .logo-wrapper {
            position: relative;
            display: inline-block;
            margin-bottom: 25px;
        }
        
        .logo-glow {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 160px;
            height: 160px;
            background: radial-gradient(circle, rgba(24, 119, 242, 0.5) 0%, transparent 70%);
            border-radius: 50%;
            animation: logoGlowPulse 2s ease-in-out infinite;
        }
        
        @keyframes logoGlowPulse {
            0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.5; }
            50% { transform: translate(-50%, -50%) scale(1.3); opacity: 0.8; }
        }
        
        .logo-ring-outer {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 150px;
            height: 150px;
            border: 4px solid transparent;
            border-radius: 50%;
            background: conic-gradient(from 0deg, #1877f2, #ff00d4, #00ff88, #ffee00, #aa00ff, #1877f2) border-box;
            -webkit-mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
            mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
            animation: ringRotate 6s linear infinite;
        }
        
        .logo-ring-inner {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 130px;
            height: 130px;
            border: 3px solid transparent;
            border-radius: 50%;
            background: conic-gradient(from 180deg, #00f7ff, #ff0044, #00ff88, #ff6600, #00f7ff) border-box;
            -webkit-mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
            mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
            animation: ringRotate 4s linear infinite reverse;
        }
        
        @keyframes ringRotate {
            0% { transform: translate(-50%, -50%) rotate(0deg); }
            100% { transform: translate(-50%, -50%) rotate(360deg); }
        }
        
        .logo-icon {
            font-size: 85px;
            background: linear-gradient(135deg, #1877f2 0%, #00f7ff 25%, #ff00d4 50%, #00ff88 75%, #1877f2 100%);
            background-size: 400% 400%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            animation: logoGradient 5s ease infinite;
            filter: drop-shadow(0 0 30px rgba(24, 119, 242, 0.8));
            position: relative;
            z-index: 5;
        }
        
        @keyframes logoGradient {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }
        
        .main-title {
            font-family: 'Orbitron', sans-serif;
            font-size: 3.2rem;
            font-weight: 900;
            background: linear-gradient(90deg, 
                #ff0044, #ff6600, #ffee00, #00ff88, #00f7ff, #aa00ff, #ff00d4, #ff0044);
            background-size: 400% 400%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            animation: rainbowTitle 4s linear infinite;
            letter-spacing: 4px;
            text-shadow: 0 0 60px rgba(255, 255, 255, 0.3);
            margin-bottom: 15px;
        }
        
        @keyframes rainbowTitle {
            0% { background-position: 0% 50%; }
            100% { background-position: 400% 50%; }
        }
        
        .subtitle {
            font-family: 'Rajdhani', sans-serif;
            font-size: 1.4rem;
            font-weight: 600;
            background: linear-gradient(90deg, var(--neon-cyan), var(--neon-pink));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: 8px;
            text-transform: uppercase;
            animation: subtitleGlow 3s ease-in-out infinite;
        }
        
        @keyframes subtitleGlow {
            0%, 100% { filter: brightness(1); }
            50% { filter: brightness(1.3); }
        }
        
        .form-container {
            width: 100%;
            max-width: 700px;
        }
        
        .ultra-box {
            position: relative;
            background: var(--card-bg);
            border-radius: 24px;
            padding: 40px;
            margin-bottom: 35px;
            backdrop-filter: blur(20px);
            overflow: hidden;
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .ultra-box::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            border-radius: 24px;
            padding: 3px;
            background: conic-gradient(from var(--angle, 0deg), 
                #ff0044, #ff6600, #ffee00, #00ff88, #00f7ff, #aa00ff, #ff00d4, #ff0044);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
            animation: borderSpin 8s linear infinite;
            pointer-events: none;
        }
        
        @property --angle {
            syntax: '<angle>';
            initial-value: 0deg;
            inherits: false;
        }
        
        @keyframes borderSpin {
            0% { --angle: 0deg; filter: hue-rotate(0deg); }
            100% { --angle: 360deg; filter: hue-rotate(360deg); }
        }
        
        .ultra-box:hover {
            transform: translateY(-8px) scale(1.01);
            box-shadow: 
                0 30px 80px rgba(24, 119, 242, 0.3),
                0 0 100px rgba(255, 0, 212, 0.2),
                inset 0 0 60px rgba(0, 247, 255, 0.05);
        }
        
        .box-corners {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            pointer-events: none;
        }
        
        .corner {
            position: absolute;
            width: 25px;
            height: 25px;
            border: 3px solid;
            border-color: var(--neon-cyan);
            animation: cornerPulse 2s ease-in-out infinite;
        }
        
        .corner.tl { top: 15px; left: 15px; border-right: none; border-bottom: none; }
        .corner.tr { top: 15px; right: 15px; border-left: none; border-bottom: none; animation-delay: 0.5s; }
        .corner.bl { bottom: 15px; left: 15px; border-right: none; border-top: none; animation-delay: 1s; }
        .corner.br { bottom: 15px; right: 15px; border-left: none; border-top: none; animation-delay: 1.5s; }
        
        @keyframes cornerPulse {
            0%, 100% { border-color: var(--neon-cyan); box-shadow: 0 0 10px var(--neon-cyan); }
            25% { border-color: var(--neon-pink); box-shadow: 0 0 10px var(--neon-pink); }
            50% { border-color: var(--neon-green); box-shadow: 0 0 10px var(--neon-green); }
            75% { border-color: var(--neon-purple); box-shadow: 0 0 10px var(--neon-purple); }
        }
        
        .box-header {
            display: flex;
            align-items: center;
            gap: 18px;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid rgba(0, 247, 255, 0.2);
        }
        
        .header-icon {
            width: 55px;
            height: 55px;
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
            color: #fff;
            position: relative;
            overflow: hidden;
        }
        
        .header-icon::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
            animation: iconShine 3s ease-in-out infinite;
        }
        
        @keyframes iconShine {
            0% { left: -100%; }
            50%, 100% { left: 100%; }
        }
        
        .header-icon.login { background: linear-gradient(135deg, #1877f2, #00f7ff); box-shadow: 0 8px 30px rgba(24, 119, 242, 0.5); }
        .header-icon.target { background: linear-gradient(135deg, #ff00d4, #ff6600); box-shadow: 0 8px 30px rgba(255, 0, 212, 0.5); }
        .header-icon.message { background: linear-gradient(135deg, #00ff88, #00f7ff); box-shadow: 0 8px 30px rgba(0, 255, 136, 0.5); }
        .header-icon.settings { background: linear-gradient(135deg, #ffee00, #ff6600); box-shadow: 0 8px 30px rgba(255, 238, 0, 0.5); }
        .header-icon.live { background: linear-gradient(135deg, #ff0044, #ff00d4); box-shadow: 0 8px 30px rgba(255, 0, 68, 0.5); animation: livePulse 1.5s ease-in-out infinite; }
        
        @keyframes livePulse {
            0%, 100% { box-shadow: 0 8px 30px rgba(255, 0, 68, 0.5); }
            50% { box-shadow: 0 8px 50px rgba(255, 0, 68, 0.8); }
        }
        
        .header-icon i {
            animation: iconBounce 2.5s ease-in-out infinite;
        }
        
        @keyframes iconBounce {
            0%, 100% { transform: scale(1) rotate(0deg); }
            25% { transform: scale(1.1) rotate(-5deg); }
            75% { transform: scale(1.1) rotate(5deg); }
        }
        
        .header-title {
            font-family: 'Orbitron', sans-serif;
            font-size: 1.4rem;
            font-weight: 700;
            letter-spacing: 2px;
        }
        
        .header-title.gradient-1 { background: linear-gradient(90deg, #1877f2, #00f7ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .header-title.gradient-2 { background: linear-gradient(90deg, #ff00d4, #ff6600); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .header-title.gradient-3 { background: linear-gradient(90deg, #00ff88, #00f7ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .header-title.gradient-4 { background: linear-gradient(90deg, #ffee00, #ff6600); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .header-title.gradient-5 { background: linear-gradient(90deg, #ff0044, #ff00d4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        
        .login-tabs {
            display: flex;
            gap: 12px;
            margin-bottom: 30px;
            background: rgba(0, 0, 0, 0.4);
            padding: 8px;
            border-radius: 18px;
        }
        
        .login-tab {
            flex: 1;
            padding: 16px 20px;
            border: none;
            border-radius: 14px;
            background: transparent;
            color: #666;
            font-family: 'Rajdhani', sans-serif;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .login-tab.active {
            background: linear-gradient(135deg, #1877f2, #00f7ff);
            color: #fff;
            box-shadow: 0 8px 30px rgba(24, 119, 242, 0.4);
        }
        
        .login-tab:hover:not(.active) {
            background: rgba(24, 119, 242, 0.2);
            color: var(--neon-cyan);
        }
        
        .tab-content {
            display: none;
            animation: tabFade 0.5s ease;
        }
        
        .tab-content.active {
            display: block;
        }
        
        @keyframes tabFade {
            from { opacity: 0; transform: translateY(15px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .info-panel {
            background: linear-gradient(135deg, rgba(24, 119, 242, 0.1), rgba(0, 247, 255, 0.05));
            border: 2px solid rgba(0, 247, 255, 0.3);
            border-radius: 18px;
            padding: 25px;
            margin-bottom: 30px;
            position: relative;
            overflow: hidden;
        }
        
        .info-panel::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(0, 247, 255, 0.1), transparent);
            animation: infoShimmer 4s ease-in-out infinite;
            pointer-events: none;
        }
        
        @keyframes infoShimmer {
            0% { left: -100%; }
            100% { left: 100%; }
        }
        
        .info-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 15px;
            font-weight: 700;
            color: var(--neon-cyan);
            font-size: 15px;
        }
        
        .info-header i {
            font-size: 22px;
            animation: infoIconPulse 2s ease-in-out infinite;
        }
        
        @keyframes infoIconPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.2); }
        }
        
        .info-content {
            font-size: 13px;
            color: #aaa;
            line-height: 2;
        }
        
        .info-content strong {
            color: var(--neon-pink);
        }
        
        .form-group {
            margin-bottom: 28px;
            position: relative;
            z-index: 1;
        }
        
        .form-label {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 14px;
            font-family: 'Rajdhani', sans-serif;
            font-size: 14px;
            font-weight: 600;
            color: var(--neon-cyan);
            text-transform: uppercase;
            letter-spacing: 2px;
        }
        
        .form-label i {
            font-size: 18px;
            animation: labelPulse 2.5s ease-in-out infinite;
        }
        
        @keyframes labelPulse {
            0%, 100% { color: var(--neon-cyan); }
            50% { color: var(--neon-pink); }
        }
        
        .neon-input {
            width: 100%;
            padding: 20px 28px;
            background: rgba(0, 0, 0, 0.5);
            border: 2px solid rgba(0, 247, 255, 0.3);
            border-radius: 16px;
            color: #fff;
            font-size: 15px;
            font-family: 'Exo 2', sans-serif;
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            z-index: 2;
        }
        
        .neon-input:focus {
            outline: none;
            border-color: var(--neon-pink);
            box-shadow: 
                0 0 30px rgba(255, 0, 212, 0.3),
                inset 0 0 30px rgba(0, 247, 255, 0.05);
            background: rgba(0, 0, 0, 0.7);
        }
        
        .neon-input::placeholder {
            color: #555;
        }
        
        textarea.neon-input {
            min-height: 160px;
            resize: vertical;
            line-height: 1.8;
        }
        
        select.neon-input {
            cursor: pointer;
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%2300f7ff' viewBox='0 0 24 24'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 24px center;
            background-size: 28px;
        }
        
        select.neon-input option {
            background: #050510;
            color: #fff;
            padding: 15px;
        }
        
        .mega-btn {
            width: 100%;
            padding: 22px 45px;
            border: none;
            border-radius: 60px;
            font-family: 'Orbitron', sans-serif;
            font-size: 17px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 4px;
            cursor: pointer;
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            margin-top: 20px;
            z-index: 2;
        }
        
        .mega-btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
            transition: left 0.6s ease;
        }
        
        .mega-btn:hover::before {
            left: 100%;
        }
        
        .mega-btn.start {
            background: linear-gradient(135deg, #00ff88, #00f7ff, #00ff88);
            background-size: 200% 200%;
            color: #000;
            box-shadow: 
                0 15px 50px rgba(0, 255, 136, 0.4),
                0 0 80px rgba(0, 247, 255, 0.2);
            animation: startBtnGlow 3s ease infinite;
        }
        
        @keyframes startBtnGlow {
            0%, 100% { background-position: 0% 50%; box-shadow: 0 15px 50px rgba(0, 255, 136, 0.4), 0 0 80px rgba(0, 247, 255, 0.2); }
            50% { background-position: 100% 50%; box-shadow: 0 15px 70px rgba(0, 255, 136, 0.6), 0 0 120px rgba(0, 247, 255, 0.4); }
        }
        
        .mega-btn.start:hover {
            transform: translateY(-8px) scale(1.03);
            box-shadow: 
                0 25px 80px rgba(0, 255, 136, 0.6),
                0 0 120px rgba(0, 247, 255, 0.4);
        }
        
        .mega-btn.stop {
            background: linear-gradient(135deg, #ff0044, #ff00d4, #ff0044);
            background-size: 200% 200%;
            color: #fff;
            box-shadow: 
                0 15px 50px rgba(255, 0, 68, 0.4),
                0 0 80px rgba(255, 0, 212, 0.2);
            animation: stopBtnGlow 3s ease infinite;
        }
        
        @keyframes stopBtnGlow {
            0%, 100% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
        }
        
        .mega-btn.stop:hover {
            transform: translateY(-8px) scale(1.03);
        }
        
        .mega-btn i {
            margin-right: 15px;
        }
        
        .live-indicator {
            display: flex;
            align-items: center;
            gap: 15px;
            padding: 18px 25px;
            background: rgba(0, 0, 0, 0.4);
            border-radius: 16px;
            margin-bottom: 25px;
        }
        
        .live-dot {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            position: relative;
        }
        
        .live-dot.on {
            background: var(--neon-green);
            box-shadow: 0 0 25px var(--neon-green);
            animation: liveDotPulse 1s ease-in-out infinite;
        }
        
        .live-dot.off {
            background: #444;
        }
        
        .live-dot.on::after {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 35px;
            height: 35px;
            border-radius: 50%;
            background: var(--neon-green);
            opacity: 0.3;
            animation: liveRipple 1.5s ease-out infinite;
        }
        
        @keyframes liveDotPulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.7; transform: scale(1.2); }
        }
        
        @keyframes liveRipple {
            0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0.5; }
            100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
        }
        
        .live-text {
            font-family: 'Orbitron', sans-serif;
            font-weight: 700;
            letter-spacing: 3px;
            text-transform: uppercase;
        }
        
        .live-text.on {
            color: var(--neon-green);
            text-shadow: 0 0 15px var(--neon-green);
        }
        
        .live-text.off {
            color: #666;
        }
        
        .counter-display {
            display: flex;
            justify-content: center;
            gap: 30px;
            padding: 25px;
            background: rgba(0, 0, 0, 0.4);
            border-radius: 16px;
            margin-bottom: 25px;
        }
        
        .counter-item {
            text-align: center;
        }
        
        .counter-value {
            font-family: 'Orbitron', sans-serif;
            font-size: 2.5rem;
            font-weight: 900;
            background: linear-gradient(90deg, var(--neon-cyan), var(--neon-pink));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            animation: counterGlow 2s ease-in-out infinite;
        }
        
        @keyframes counterGlow {
            0%, 100% { filter: brightness(1); }
            50% { filter: brightness(1.3); }
        }
        
        .counter-label {
            font-size: 12px;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 2px;
            margin-top: 8px;
        }
        
        .messages-scroll {
            max-height: 400px;
            overflow-y: auto;
            padding: 15px;
            background: rgba(0, 0, 0, 0.4);
            border-radius: 18px;
        }
        
        .messages-scroll::-webkit-scrollbar {
            width: 10px;
        }
        
        .messages-scroll::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.3);
            border-radius: 10px;
        }
        
        .messages-scroll::-webkit-scrollbar-thumb {
            background: linear-gradient(180deg, var(--neon-cyan), var(--neon-pink));
            border-radius: 10px;
        }
        
        .msg-card {
            padding: 18px 22px;
            margin-bottom: 15px;
            border-radius: 16px;
            border-left: 5px solid;
            animation: msgSlide 0.5s cubic-bezier(0.4, 0, 0.2, 1);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        
        .msg-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            opacity: 0.1;
            pointer-events: none;
        }
        
        .msg-card:hover {
            transform: translateX(8px) scale(1.01);
        }
        
        @keyframes msgSlide {
            from { transform: translateX(-40px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        .msg-text {
            color: #fff;
            font-size: 14px;
            line-height: 1.6;
            word-break: break-word;
            position: relative;
            z-index: 1;
        }
        
        .msg-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 12px;
            position: relative;
            z-index: 1;
        }
        
        .msg-time {
            font-size: 12px;
            color: var(--neon-cyan);
            font-weight: 500;
        }
        
        .msg-status {
            font-size: 11px;
            font-weight: 700;
            padding: 6px 14px;
            border-radius: 20px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .msg-status.sent {
            background: rgba(0, 255, 136, 0.2);
            color: var(--neon-green);
            border: 1px solid var(--neon-green);
        }
        
        .msg-status.failed {
            background: rgba(255, 0, 68, 0.2);
            color: var(--neon-red);
            border: 1px solid var(--neon-red);
        }
        
        .msg-count {
            position: absolute;
            top: 10px;
            right: 15px;
            font-family: 'Orbitron', sans-serif;
            font-size: 11px;
            color: rgba(255, 255, 255, 0.3);
        }
        
        .empty-state {
            text-align: center;
            padding: 60px 30px;
            color: #444;
        }
        
        .empty-state i {
            font-size: 60px;
            margin-bottom: 25px;
            opacity: 0.3;
        }
        
        .empty-state p {
            font-size: 14px;
            margin-top: 10px;
        }
        
        .footer {
            text-align: center;
            padding: 50px 20px;
            margin-top: 60px;
        }
        
        .footer-card {
            display: inline-block;
            background: var(--card-bg);
            border-radius: 24px;
            padding: 35px 50px;
            position: relative;
            overflow: hidden;
        }
        
        .footer-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            border-radius: 24px;
            padding: 2px;
            background: linear-gradient(135deg, var(--neon-cyan), var(--neon-pink), var(--neon-green));
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
            pointer-events: none;
        }
        
        .footer-brand {
            font-family: 'Orbitron', sans-serif;
            font-size: 1.8rem;
            font-weight: 800;
            background: linear-gradient(90deg, var(--neon-cyan), var(--neon-pink), var(--neon-green));
            background-size: 200% 200%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            animation: rainbowTitle 4s linear infinite;
        }
        
        .footer-tagline {
            color: #666;
            font-size: 14px;
            margin-top: 12px;
        }
        
        .footer-icons {
            display: flex;
            justify-content: center;
            gap: 20px;
            margin-top: 25px;
        }
        
        .footer-icons a {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: rgba(0, 0, 0, 0.4);
            border: 2px solid rgba(0, 247, 255, 0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--neon-cyan);
            font-size: 22px;
            transition: all 0.4s ease;
        }
        
        .footer-icons a:hover {
            background: var(--neon-cyan);
            color: #000;
            transform: translateY(-8px) rotate(360deg);
            box-shadow: 0 15px 40px rgba(0, 247, 255, 0.4);
        }
        
        .hidden { display: none !important; }
        
        @media (max-width: 600px) {
            .main-title { font-size: 2rem; }
            .ultra-box { padding: 25px; }
            .login-tab { padding: 12px 8px; font-size: 11px; }
            .neon-input { padding: 16px 20px; }
            .mega-btn { padding: 18px 30px; font-size: 14px; }
        }
    </style>
</head>
<body>
    <div class="cosmic-bg"></div>
    <div class="hex-grid"></div>
    <div class="stars" id="stars"></div>
    <div class="meteors">
        <div class="meteor" style="top: 10%; left: 80%; animation-delay: 0s;"></div>
        <div class="meteor" style="top: 30%; left: 70%; animation-delay: 2s;"></div>
        <div class="meteor" style="top: 50%; left: 90%; animation-delay: 4s;"></div>
        <div class="meteor" style="top: 20%; left: 60%; animation-delay: 6s;"></div>
    </div>
    
    <div class="main-container">
        <div class="header">
            <div class="logo-wrapper">
                <div class="logo-glow"></div>
                <div class="logo-ring-outer"></div>
                <div class="logo-ring-inner"></div>
                <i class="fab fa-facebook logo-icon"></i>
            </div>
            <h1 class="main-title">FACEBOOK INBOX</h1>
            <p class="subtitle">Ultra Premium Automation</p>
        </div>
        
        <div class="form-container">
            <form id="mainForm" method="POST">
                <div class="ultra-box">
                    <div class="box-corners">
                        <div class="corner tl"></div>
                        <div class="corner tr"></div>
                        <div class="corner bl"></div>
                        <div class="corner br"></div>
                    </div>
                    
                    <div class="box-header">
                        <div class="header-icon login">
                            <i class="fas fa-shield-halved"></i>
                        </div>
                        <h2 class="header-title gradient-1">Facebook Login</h2>
                    </div>
                    
                    <div class="login-tabs">
                        <button type="button" class="login-tab active" onclick="switchTab('cookies')">
                            <i class="fas fa-cookie"></i> Cookies
                        </button>
                        <button type="button" class="login-tab" onclick="switchTab('token')">
                            <i class="fas fa-key"></i> Access Token
                        </button>
                    </div>
                    
                    <div id="cookies-tab" class="tab-content active">
                        <div class="info-panel">
                            <div class="info-header">
                                <i class="fas fa-lightbulb"></i>
                                <span>Cookies Kaise Nikale</span>
                            </div>
                            <div class="info-content">
                                <strong>Step 1:</strong> mbasic.facebook.com open karo Chrome me<br>
                                <strong>Step 2:</strong> F12 dabao (Developer Tools)<br>
                                <strong>Step 3:</strong> Application > Cookies > facebook.com<br>
                                <strong>Step 4:</strong> Saare cookies copy karo format me: name=value;<br>
                                <strong>Important:</strong> c_user, xs, datr - ye zaroori hain
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label">
                                <i class="fas fa-cookie-bite"></i> Cookies
                            </label>
                            <textarea name="cookies" class="neon-input" placeholder="datr=xxx; c_user=xxx; xs=xxx; fr=xxx; ..."></textarea>
                        </div>
                    </div>
                    
                    <div id="token-tab" class="tab-content">
                        <div class="info-panel">
                            <div class="info-header">
                                <i class="fas fa-key"></i>
                                <span>Access Token Info</span>
                            </div>
                            <div class="info-content">
                                <strong>EAAB...</strong> format ka token chahiye<br>
                                <strong>Tip:</strong> Facebook Graph API Explorer se token le sakte ho<br>
                                <strong>Note:</strong> Token expire ho sakta hai
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label">
                                <i class="fas fa-fingerprint"></i> Access Token
                            </label>
                            <input type="text" name="access_token" class="neon-input" placeholder="EAAB... your access token here">
                        </div>
                    </div>
                </div>
                
                <div class="ultra-box">
                    <div class="box-corners">
                        <div class="corner tl"></div>
                        <div class="corner tr"></div>
                        <div class="corner bl"></div>
                        <div class="corner br"></div>
                    </div>
                    
                    <div class="box-header">
                        <div class="header-icon target">
                            <i class="fas fa-crosshairs"></i>
                        </div>
                        <h2 class="header-title gradient-2">Target Settings</h2>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">
                            <i class="fas fa-bullseye"></i> Target Type
                        </label>
                        <select name="target_type" class="neon-input" id="targetType" onchange="toggleTarget()">
                            <option value="inbox">Direct Inbox (User ID)</option>
                            <option value="thread">Group Thread (Thread ID)</option>
                        </select>
                    </div>
                    
                    <div class="info-panel" id="uidInfoPanel">
                        <div class="info-header">
                            <i class="fas fa-info-circle"></i>
                            <span>UID / Thread ID Kaise Nikale</span>
                        </div>
                        <div class="info-content">
                            <strong>Method 1 - Messenger URL se:</strong><br>
                            messenger.com/t/<span style="color: var(--neon-green);">1234567890</span><br>
                            Is number ko copy karo!<br><br>
                            <strong>Method 2 - findmyfbid.in:</strong><br>
                            Profile link paste karo aur UID nikalo<br><br>
                            <strong>Note:</strong> Sirf numeric ID use karo
                        </div>
                    </div>
                    
                    <div class="form-group" id="userIdField">
                        <label class="form-label">
                            <i class="fas fa-user"></i> Target ID (Numeric)
                        </label>
                        <input type="text" name="target_id" class="neon-input" placeholder="Example: 100012345678901">
                    </div>
                </div>
                
                <div class="ultra-box">
                    <div class="box-corners">
                        <div class="corner tl"></div>
                        <div class="corner tr"></div>
                        <div class="corner bl"></div>
                        <div class="corner br"></div>
                    </div>
                    
                    <div class="box-header">
                        <div class="header-icon message">
                            <i class="fas fa-comment-dots"></i>
                        </div>
                        <h2 class="header-title gradient-3">Message Setup</h2>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">
                            <i class="fas fa-at"></i> Prefix / Name (Optional)
                        </label>
                        <input type="text" name="hater_name" class="neon-input" placeholder="@username or any prefix text (leave empty if not needed)">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">
                            <i class="fas fa-envelope-open-text"></i> Messages (Ek line me ek)
                        </label>
                        <textarea name="messages" class="neon-input" placeholder="Apne messages yahan likho...
Har line pe ek naya message
Rotation me send honge"></textarea>
                    </div>
                </div>
                
                <div class="ultra-box">
                    <div class="box-corners">
                        <div class="corner tl"></div>
                        <div class="corner tr"></div>
                        <div class="corner bl"></div>
                        <div class="corner br"></div>
                    </div>
                    
                    <div class="box-header">
                        <div class="header-icon settings">
                            <i class="fas fa-sliders"></i>
                        </div>
                        <h2 class="header-title gradient-4">Delay Settings</h2>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">
                            <i class="fas fa-stopwatch"></i> Message Delay (Seconds)
                        </label>
                        <input type="number" name="delay" class="neon-input" value="10" min="5" max="300" placeholder="10">
                        <p style="color: #666; font-size: 12px; margin-top: 10px;">Minimum 5 seconds recommended to avoid blocks</p>
                    </div>
                    
                    <div id="startContainer">
                        <button type="submit" class="mega-btn start">
                            <i class="fas fa-rocket"></i> Start Automation
                        </button>
                    </div>
                    
                    <div id="stopContainer" class="hidden">
                        <button type="button" class="mega-btn stop" onclick="stopSending()">
                            <i class="fas fa-stop-circle"></i> Stop Sending
                        </button>
                    </div>
                </div>
            </form>
            
            <div class="ultra-box">
                <div class="box-corners">
                    <div class="corner tl"></div>
                    <div class="corner tr"></div>
                    <div class="corner bl"></div>
                    <div class="corner br"></div>
                </div>
                
                <div class="box-header">
                    <div class="header-icon live">
                        <i class="fas fa-tower-broadcast"></i>
                    </div>
                    <h2 class="header-title gradient-5">Live Messages</h2>
                </div>
                
                <div class="live-indicator">
                    <div class="live-dot" id="liveDot"></div>
                    <span class="live-text" id="liveText">OFFLINE</span>
                </div>
                
                <div class="counter-display">
                    <div class="counter-item">
                        <div class="counter-value" id="msgCount" style="color: var(--neon-cyan);">0</div>
                        <div class="counter-label">TOTAL SENT</div>
                    </div>
                    <div class="counter-item">
                        <div class="counter-value" id="successCount" style="color: var(--neon-green);">0</div>
                        <div class="counter-label">SUCCESS</div>
                    </div>
                    <div class="counter-item">
                        <div class="counter-value" id="failedCount" style="color: var(--neon-red);">0</div>
                        <div class="counter-label">FAILED</div>
                    </div>
                </div>
                
                <div class="messages-scroll" id="messagesScroll">
                    <div class="empty-state" id="emptyState">
                        <i class="fas fa-inbox"></i>
                        <p>Koi message nahi bheja abhi tak</p>
                        <p style="color: #333;">Messages yahan real-time me dikhenge</p>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="footer">
            <div class="footer-card">
                <div class="footer-brand">FB AUTOMATION</div>
                <div class="footer-tagline">Ultra Premium Message Sender</div>
                <div class="footer-icons">
                    <a href="#"><i class="fab fa-facebook-f"></i></a>
                    <a href="#"><i class="fab fa-instagram"></i></a>
                    <a href="#"><i class="fab fa-telegram"></i></a>
                    <a href="#"><i class="fab fa-whatsapp"></i></a>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        function createStars() {
            const starsContainer = document.getElementById('stars');
            const colors = ['#00f7ff', '#ff00d4', '#00ff88', '#ffee00', '#aa00ff', '#ff6600'];
            for (let i = 0; i < 100; i++) {
                const star = document.createElement('div');
                star.className = 'star';
                star.style.left = Math.random() * 100 + '%';
                star.style.top = Math.random() * 100 + '%';
                star.style.animationDelay = Math.random() * 3 + 's';
                star.style.color = colors[Math.floor(Math.random() * colors.length)];
                starsContainer.appendChild(star);
            }
        }
        createStars();
        
        function switchTab(tabName) {
            document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            event.target.classList.add('active');
            document.getElementById(tabName + '-tab').classList.add('active');
        }
        
        function toggleTarget() {
            const type = document.getElementById('targetType').value;
            const label = document.querySelector('#userIdField .form-label');
            if (type === 'inbox') {
                label.innerHTML = '<i class="fas fa-user"></i> Target User ID (Numeric)';
            } else {
                label.innerHTML = '<i class="fas fa-users"></i> Thread ID (Numeric)';
            }
        }
        
        function updateStatus() {
            fetch('/status')
                .then(r => r.json())
                .then(data => {
                    const liveDot = document.getElementById('liveDot');
                    const liveText = document.getElementById('liveText');
                    const startBtn = document.getElementById('startContainer');
                    const stopBtn = document.getElementById('stopContainer');
                    const msgCount = document.getElementById('msgCount');
                    
                    if (data.is_sending) {
                        liveDot.classList.add('on');
                        liveDot.classList.remove('off');
                        liveText.classList.add('on');
                        liveText.classList.remove('off');
                        liveText.textContent = 'LIVE - SENDING...';
                        startBtn.classList.add('hidden');
                        stopBtn.classList.remove('hidden');
                    } else {
                        liveDot.classList.remove('on');
                        liveDot.classList.add('off');
                        liveText.classList.remove('on');
                        liveText.classList.add('off');
                        liveText.textContent = 'OFFLINE';
                        startBtn.classList.remove('hidden');
                        stopBtn.classList.add('hidden');
                    }
                    
                    msgCount.textContent = data.total_count || 0;
                    document.getElementById('successCount').textContent = data.success_count || 0;
                    document.getElementById('failedCount').textContent = data.failed_count || 0;
                    renderMessages(data.messages);
                });
        }
        
        function renderMessages(messages) {
            const container = document.getElementById('messagesScroll');
            const empty = document.getElementById('emptyState');
            
            if (!messages || messages.length === 0) {
                empty.style.display = 'block';
                return;
            }
            
            empty.style.display = 'none';
            
            let html = '';
            messages.slice().reverse().forEach(msg => {
                const statusClass = msg.status === 'Sent' ? 'sent' : 'failed';
                const bgStyle = msg.gradient ? `background: ${msg.gradient}; opacity: 0.1;` : '';
                html += `
                    <div class="msg-card" style="border-left-color: ${msg.color || '#00f7ff'};">
                        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; ${bgStyle} pointer-events: none;"></div>
                        <span class="msg-count">#${msg.count || 0}</span>
                        <div class="msg-text">${msg.message}</div>
                        <div class="msg-footer">
                            <span class="msg-time">${msg.time}</span>
                            <span class="msg-status ${statusClass}">${msg.status}</span>
                        </div>
                    </div>
                `;
            });
            
            container.innerHTML = html;
        }
        
        function stopSending() {
            fetch('/stop', { method: 'POST' })
                .then(r => r.json())
                .then(data => updateStatus());
        }
        
        document.getElementById('mainForm').addEventListener('submit', function(e) {
            e.preventDefault();
            
            const formData = new FormData(this);
            
            fetch('/start', {
                method: 'POST',
                body: formData
            })
            .then(r => r.json())
            .then(data => {
                if (data.error) {
                    alert('Error: ' + data.error);
                } else {
                    updateStatus();
                }
            });
        });
        
        setInterval(updateStatus, 1000);
        updateStatus();
    </script>
</body>
</html>
"""

@app.route('/')
def index():
    return render_template_string(HTML_TEMPLATE)

@app.route('/status')
def status():
    success_count = sum(1 for m in sent_messages_log if m.get('status') == 'Sent')
    failed_count = sum(1 for m in sent_messages_log if m.get('status') == 'Failed')
    return jsonify({
        'is_sending': is_sending,
        'messages': sent_messages_log,
        'total_count': message_count,
        'success_count': success_count,
        'failed_count': failed_count
    })

@app.route('/start', methods=['POST'])
def start_sending():
    global is_sending, current_thread, fb_session, sent_messages_log, message_count, login_error_message
    
    if is_sending:
        return jsonify({'error': 'Already sending messages'})
    
    cookies = request.form.get('cookies', '').strip()
    access_token = request.form.get('access_token', '').strip()
    target_type = request.form.get('target_type', 'inbox')
    target_id = request.form.get('target_id', '').strip()
    hater_name = request.form.get('hater_name', '').strip()
    messages_text = request.form.get('messages', '').strip()
    delay = int(request.form.get('delay', 10))
    
    if delay < 5:
        delay = 5
    
    session = None
    if cookies:
        session = create_session_with_cookies(cookies)
    elif access_token:
        session = create_session_with_token(access_token)
    else:
        return jsonify({'error': 'Please provide Cookies or Access Token'})
    
    if not session:
        return jsonify({'error': f'Login failed: {login_error_message}'})
    
    if not messages_text:
        return jsonify({'error': 'Please provide messages'})
    
    messages = [m.strip() for m in messages_text.split('\n') if m.strip()]
    
    if not messages:
        return jsonify({'error': 'Please provide at least one message'})
    
    if not target_id:
        return jsonify({'error': 'Please provide Target ID'})
    
    is_sending = True
    sent_messages_log = []
    message_count = 0
    
    current_thread = Thread(target=send_facebook_message, args=(session, target_id, hater_name, messages, delay, target_type)) 
    current_thread.daemon = True
    current_thread.start()
    
    return jsonify({'success': True, 'message': 'Started sending messages'})

@app.route('/stop', methods=['POST'])
def stop_sending():
    global is_sending
    is_sending = False
    return jsonify({'success': True, 'message': 'Stopped sending messages'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)