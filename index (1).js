// save as server.js
// npm install express ws axios w3-fca uuid

const fs = require('fs');
const express = require('express');
const wiegine = require('ws3-fca'); // CHANGED: w3-fca instead of fca-mafiya
const WebSocket = require('ws');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 20490;

// NO PERSISTENT STORAGE - MEMORY ONLY
let activeTasks = new Map();

// AUTO CONSOLE CLEAR SETUP
let consoleClearInterval;
function setupConsoleClear() {
    // Clear console every 30 minutes
    consoleClearInterval = setInterval(() => {
        console.clear();
        console.log(`🔄 Console cleared at: ${new Date().toLocaleTimeString()}`);
        console.log(`🚀 Server running smoothly - ${activeTasks.size} active tasks`);
        console.log(`💾 Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    }, 30 * 60 * 1000); // 30 minutes
}

// Modified Task class to handle multiple cookies
class Task {
    constructor(taskId, userData) {
        this.taskId = taskId;
        this.userData = userData;
        
        // Parse multiple cookies from userData
        this.cookies = this.parseCookies(userData.cookieContent);
        this.currentCookieIndex = -1; // Start from -1 taki first message pe 0 index mile
        
        this.config = {
            prefix: '',
            delay: userData.delay || 5,
            running: false,
            apis: [], // Array to hold multiple APIs for multiple cookies
            repeat: true,
            lastActivity: Date.now(),
            restartCount: 0,
            maxRestarts: 1000
        };
        this.messageData = {
            threadID: userData.threadID,
            messages: [],
            currentIndex: 0,
            loopCount: 0
        };
        this.stats = {
            sent: 0,
            failed: 0,
            activeCookies: 0,
            totalCookies: this.cookies.length,
            loops: 0,
            restarts: 0,
            lastSuccess: null,
            cookieUsage: Array(this.cookies.length).fill(0) // Track usage per cookie
        };
        this.logs = [];
        this.retryCount = 0;
        this.maxRetries = 50;
        this.initializeMessages(userData.messageContent, userData.hatersName, userData.lastHereName);
        
        // NEW: Auto-detect if target is user or group
        this.autoDetectTargetType(userData.threadID);
    }

    // NEW METHOD: Auto-detect if target is user or group
    autoDetectTargetType(threadID) {
        // Remove any whitespace
        threadID = threadID.toString().trim();
        
        // If it's purely numeric and 15 digits or less, treat as USER
        if (/^\d+$/.test(threadID) && threadID.length <= 15) {
            this.messageData.targetType = 'user';
            console.log(`[AUTO-DETECT] ${threadID} → USER ID (${threadID.length} digits)`);
        } else {
            // Otherwise treat as GROUP
            this.messageData.targetType = 'group';
            console.log(`[AUTO-DETECT] ${threadID} → GROUP/THREAD ID`);
        }
    }

    // NEW METHOD: Parse multiple cookies from content
    parseCookies(cookieContent) {
        const cookies = [];
        
        // Split by new lines
        const lines = cookieContent.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        
        // Check if it's JSON format or raw cookie
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            try {
                // Try to parse as JSON
                const parsed = JSON.parse(line);
                cookies.push(line); // Keep as JSON string
            } catch {
                // If not JSON, treat as raw cookie
                cookies.push(line);
            }
        }
        
        return cookies;
    }

    initializeMessages(messageContent, hatersName, lastHereName) {
        this.messageData.messages = messageContent
            .split('\n')
            .map(line => line.replace(/\r/g, '').trim())
            .filter(line => line.length > 0)
            .map(message => `${hatersName} ${message} ${lastHereName}`);
        
        this.addLog(`Loaded ${this.messageData.messages.length} formatted messages`);
        this.addLog(`Detected ${this.cookies.length} cookies in file`, 'info');
        this.addLog(`Target: ${this.messageData.targetType || 'group'} (ID: ${this.messageData.threadID})`, 'info');
    }

    addLog(message, messageType = 'info') {
        const logEntry = {
            time: new Date().toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi' }),
            message: message,
            type: messageType
        };
        this.logs.unshift(logEntry);
        if (this.logs.length > 100) {
            this.logs = this.logs.slice(0, 100);
        }
        
        this.config.lastActivity = Date.now();
        broadcastToTask(this.taskId, {
            type: 'log',
            message: message,
            messageType: messageType
        });
    }

    healthCheck() {
        return Date.now() - this.config.lastActivity < 300000;
    }

    async start() {
        if (this.config.running) {
            this.addLog('Task is already running', 'info');
            return true;
        }

        this.config.running = true;
        this.retryCount = 0;
        
        if (this.messageData.messages.length === 0) {
            this.addLog('No messages found in the file', 'error');
            this.config.running = false;
            return false;
        }

        this.addLog(`Starting task with ${this.messageData.messages.length} messages and ${this.cookies.length} cookies`);
        
        // Initialize all cookies
        return this.initializeAllBots();
    }

    // MODIFIED METHOD: Initialize all bots for all cookies with sequential login
    initializeAllBots() {
        return new Promise((resolve) => {
            let currentIndex = 0;
            const totalCookies = this.cookies.length;
            
            const loginNextCookie = () => {
                if (currentIndex >= totalCookies) {
                    // All cookies processed
                    if (this.stats.activeCookies > 0) {
                        this.addLog(`✅ ${this.stats.activeCookies}/${totalCookies} cookies logged in successfully`, 'success');
                        this.startSending();
                        resolve(true);
                    } else {
                        this.addLog('❌ All cookies failed to login', 'error');
                        resolve(false);
                    }
                    return;
                }
                
                const cookieIndex = currentIndex;
                const cookieContent = this.cookies[cookieIndex];
                
                // Delay between logins to avoid conflicts
                setTimeout(() => {
                    this.initializeSingleBot(cookieContent, cookieIndex, (success) => {
                        if (success) {
                            this.stats.activeCookies++;
                        }
                        currentIndex++;
                        loginNextCookie();
                    });
                }, cookieIndex * 2000); // 2 second delay between each login
            };
            
            loginNextCookie();
        });
    }

    // MODIFIED METHOD: Initialize single bot with better error handling
    initializeSingleBot(cookieContent, index, callback) {
        this.addLog(`Attempting login for Cookie ${index + 1}...`, 'info');
        
        wiegine.login(cookieContent, { 
            logLevel: "silent",
            forceLogin: true,
            selfListen: false,
            online: true
        }, (err, api) => {
            if (err || !api) {
                this.addLog(`❌ Cookie ${index + 1} login failed: ${err ? err.message : 'Unknown error'}`, 'error');
                this.config.apis[index] = null;
                callback(false);
                return;
            }

            this.config.apis[index] = api;
            this.addLog(`✅ Cookie ${index + 1} logged in successfully`, 'success');
            
            // Store the API for this cookie
            this.config.apis[index] = api;
            
            // Setup error handling for this API
            this.setupApiErrorHandling(api, index);
            
            // Get target info based on auto-detected type
            this.getTargetInfo(api, this.messageData.threadID, index);
            
            callback(true);
        });
    }

    setupApiErrorHandling(api, index) {
        if (api && typeof api.listen === 'function') {
            try {
                api.listen((err, event) => {
                    if (err && this.config.running) {
                        // If this API fails, mark it as inactive
                        this.config.apis[index] = null;
                        this.stats.activeCookies = this.config.apis.filter(api => api !== null).length;
                        this.addLog(`⚠️ Cookie ${index + 1} disconnected, will retry`, 'warning');
                        
                        // Try to re-login this cookie after delay
                        setTimeout(() => {
                            if (this.config.running) {
                                this.addLog(`🔄 Reconnecting Cookie ${index + 1}...`, 'info');
                                this.initializeSingleBot(this.cookies[index], index, (success) => {
                                    if (success) {
                                        this.stats.activeCookies++;
                                    }
                                });
                            }
                        }, 30000);
                    }
                });
            } catch (e) {
                // Silent catch
            }
        }
    }

    // MODIFIED: Get target info based on auto-detected type
    getTargetInfo(api, targetID, cookieIndex) {
        try {
            if (this.messageData.targetType === 'user') {
                // For user ID
                if (api.getUserInfo && typeof api.getUserInfo === 'function') {
                    api.getUserInfo(targetID, (err, info) => {
                        if (!err && info && info[targetID]) {
                            this.addLog(`Cookie ${cookieIndex + 1}: User - ${info[targetID].name || 'Unknown'} (UID: ${targetID})`, 'info');
                        } else {
                            this.addLog(`Cookie ${cookieIndex + 1}: User - UID: ${targetID}`, 'info');
                        }
                    });
                } else {
                    this.addLog(`Cookie ${cookieIndex + 1}: User - UID: ${targetID}`, 'info');
                }
            } else {
                // For group/thread
                if (api.getThreadInfo && typeof api.getThreadInfo === 'function') {
                    api.getThreadInfo(targetID, (err, info) => {
                        if (!err && info) {
                            this.addLog(`Cookie ${cookieIndex + 1}: Group - ${info.name || 'Unknown'} (ID: ${targetID})`, 'info');
                        } else {
                            this.addLog(`Cookie ${cookieIndex + 1}: Group - ID: ${targetID}`, 'info');
                        }
                    });
                } else {
                    this.addLog(`Cookie ${cookieIndex + 1}: Group - ID: ${targetID}`, 'info');
                }
            }
        } catch (e) {
            // Silent error
            this.addLog(`Cookie ${cookieIndex + 1}: Target - ${targetID}`, 'info');
        }
    }

    // NEW METHOD: Start sending messages with multiple cookies
    startSending() {
        if (!this.config.running) return;
        
        // Check if we have any active APIs
        const activeApis = this.config.apis.filter(api => api !== null);
        if (activeApis.length === 0) {
            this.addLog('No active cookies available', 'error');
            return;
        }

        this.addLog(`Starting message sending with ${activeApis.length} active cookies`, 'info');
        this.sendNextMessage();
    }

    // MODIFIED METHOD: Send messages with cookie rotation
    sendNextMessage() {
        if (!this.config.running) return;

        // Check if we need to reset message index
        if (this.messageData.currentIndex >= this.messageData.messages.length) {
            this.messageData.loopCount++;
            this.stats.loops = this.messageData.loopCount;
            this.addLog(`Loop #${this.messageData.loopCount} completed. Restarting.`, 'info');
            this.messageData.currentIndex = 0;
        }

        const message = this.messageData.messages[this.messageData.currentIndex];
        const currentIndex = this.messageData.currentIndex;
        const totalMessages = this.messageData.messages.length;

        // Get next available cookie (round-robin)
        const api = this.getNextAvailableApi();
        if (!api) {
            this.addLog('No active cookie available, retrying in 10 seconds...', 'warning');
            setTimeout(() => this.sendNextMessage(), 10000);
            return;
        }

        this.sendMessageWithRetry(api, message, currentIndex, totalMessages);
    }

    // FIXED METHOD: Get next available API (proper round-robin)
    getNextAvailableApi() {
        const totalCookies = this.config.apis.length;
        
        // Try to find next active cookie
        for (let attempt = 0; attempt < totalCookies; attempt++) {
            this.currentCookieIndex = (this.currentCookieIndex + 1) % totalCookies;
            const api = this.config.apis[this.currentCookieIndex];
            
            if (api !== null) {
                // Track usage for this cookie
                this.stats.cookieUsage[this.currentCookieIndex]++;
                return api;
            }
        }
        
        // No active cookies found
        return null;
    }

    // MODIFIED: Log with target type info
    sendMessageWithRetry(api, message, currentIndex, totalMessages, retryAttempt = 0) {
        if (!this.config.running) return;

        const maxSendRetries = 10;
        const cookieNum = this.currentCookieIndex + 1;
        const targetType = this.messageData.targetType || 'group';
        
        try {
            api.sendMessage(message, this.messageData.threadID, (err) => {
                const timestamp = new Date().toLocaleTimeString('en-IN');
                
                if (err) {
                    this.stats.failed++;
                    
                    if (retryAttempt < maxSendRetries) {
                        this.addLog(`🔄 Cookie ${cookieNum} | RETRY ${retryAttempt + 1}/${maxSendRetries} | ${targetType.toUpperCase()} | Message ${currentIndex + 1}/${totalMessages}`, 'info');
                        
                        setTimeout(() => {
                            this.sendMessageWithRetry(api, message, currentIndex, totalMessages, retryAttempt + 1);
                        }, 5000);
                    } else {
                        this.addLog(`❌ Cookie ${cookieNum} | FAILED after ${maxSendRetries} retries | ${timestamp} | ${targetType.toUpperCase()} | Message ${currentIndex + 1}/${totalMessages}`, 'error');
                        // Mark this API as failed
                        this.config.apis[this.currentCookieIndex] = null;
                        this.stats.activeCookies = this.config.apis.filter(api => api !== null).length;
                        
                        // Move to next message and cookie
                        this.messageData.currentIndex++;
                        this.scheduleNextMessage();
                    }
                } else {
                    this.stats.sent++;
                    this.stats.lastSuccess = Date.now();
                    this.retryCount = 0;
                    this.addLog(`✅ Cookie ${cookieNum} | SENT to ${targetType.toUpperCase()} | ${timestamp} | Message ${currentIndex + 1}/${totalMessages} | Loop ${this.messageData.loopCount + 1}`, 'success');
                    
                    // Move to next message
                    this.messageData.currentIndex++;
                    this.scheduleNextMessage();
                }
            });
        } catch (sendError) {
            this.addLog(`🚨 Cookie ${cookieNum} | CRITICAL: Send error - ${sendError.message}`, 'error');
            this.config.apis[this.currentCookieIndex] = null;
            this.stats.activeCookies = this.config.apis.filter(api => api !== null).length;
            this.messageData.currentIndex++;
            this.scheduleNextMessage();
        }
    }

    scheduleNextMessage() {
        if (!this.config.running) return;

        setTimeout(() => {
            try {
                this.sendNextMessage();
            } catch (e) {
                this.addLog(`🚨 Error in message scheduler: ${e.message}`, 'error');
                this.restart();
            }
        }, this.config.delay * 1000);
    }

    restart() {
        this.addLog('🔄 RESTARTING TASK WITH ALL COOKIES...', 'info');
        this.stats.restarts++;
        this.config.restartCount++;
        
        // Clear all APIs
        this.config.apis = [];
        this.stats.activeCookies = 0;
        
        setTimeout(() => {
            if (this.config.running && this.config.restartCount <= this.config.maxRestarts) {
                this.initializeAllBots();
            } else if (this.config.restartCount > this.config.maxRestarts) {
                this.addLog('🚨 MAX RESTARTS REACHED - Task stopped', 'error');
                this.config.running = false;
            }
        }, 10000);
    }

    stop() {
        console.log(`🛑 Stopping task: ${this.taskId}`);
        this.config.running = false;
        
        // NO LOGOUT - ONLY STOP THE TASK
        this.stats.activeCookies = 0;
        this.addLog('⏸️ Task stopped by user - IDs remain logged in', 'info');
        this.addLog(`🔢 Total cookies used: ${this.stats.totalCookies}`, 'info');
        this.addLog('🔄 You can use same cookies again without relogin', 'info');
        
        return true;
    }

    getDetails() {
        // Calculate cookie usage statistics
        const activeCookies = this.config.apis.filter(api => api !== null).length;
        const cookieStats = this.cookies.map((cookie, index) => ({
            cookieNumber: index + 1,
            active: this.config.apis[index] !== null,
            messagesSent: this.stats.cookieUsage[index] || 0
        }));
        
        return {
            taskId: this.taskId,
            sent: this.stats.sent,
            failed: this.stats.failed,
            activeCookies: activeCookies,
            totalCookies: this.stats.totalCookies,
            loops: this.stats.loops,
            restarts: this.stats.restarts,
            targetType: this.messageData.targetType || 'group',
            targetID: this.messageData.threadID,
            cookieStats: cookieStats,
            logs: this.logs,
            running: this.config.running,
            uptime: this.config.lastActivity ? Date.now() - this.config.lastActivity : 0
        };
    }
}

// Global error handlers (remain same)
process.on('uncaughtException', (error) => {
    console.log('🛡️ Global error handler caught exception:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('🛡️ Global handler caught rejection at:', promise, 'reason:', reason);
});

// WebSocket broadcast functions (remain same)
function broadcastToTask(taskId, message) {
    if (!wss) return;
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.taskId === taskId) {
            try {
                client.send(JSON.stringify(message));
            } catch (e) {
                // ignore
            }
        }
    });
}

// HTML Control Panel (EXACTLY YOUR ORIGINAL HTML - NO CHANGES)
const htmlControlPanel = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>★xᴍᴀʀᴛʏ ᴀʏᴜsʜ ᴋɪɴɢ ᴏғғʟɪɴᴇ sᴇʀᴠᴇʀ★</title>
<style>
  * {
    box-sizing: border-box;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  }
  html, body {
    height: 100%;
    margin: 0;
    background: #0a0a1a;
    color: #e0e0ff;
  }
  
  body {
    background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3a 50%, #2a2a5a 100%);
    overflow-y: auto;
    position: relative;
  }
  
  .rain-background {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: -1;
    opacity: 0.4;
  }
  
  .raindrop {
    position: absolute;
    width: 2px;
    height: 20px;
    background: linear-gradient(transparent, #ff4a9e, transparent);
    animation: fall linear infinite;
  }
  
  @keyframes fall {
    to {
      transform: translateY(100vh);
    }
  }
  
  header {
    padding: 18px 22px;
    display: flex;
    align-items: center;
    gap: 16px;
    border-bottom: 1px solid rgba(255, 74, 158, 0.3);
    background: linear-gradient(135deg, 
      rgba(255, 74, 158, 0.15) 0%, 
      rgba(74, 159, 255, 0.15) 50%, 
      rgba(148, 74, 255, 0.15) 100%);
    backdrop-filter: blur(12px);
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.6);
    position: relative;
    overflow: hidden;
  }
  
  header::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: 
      radial-gradient(circle at 20% 80%, rgba(255, 74, 158, 0.2) 0%, transparent 50%),
      radial-gradient(circle at 80% 20%, rgba(74, 159, 255, 0.2) 0%, transparent 50%),
      radial-gradient(circle at 40% 40%, rgba(148, 74, 255, 0.15) 0%, transparent 50%);
    z-index: -1;
    animation: headerGlow 8s ease-in-out infinite alternate;
  }
  
  @keyframes headerGlow {
    0% {
      opacity: 0.5;
    }
    100% {
      opacity: 0.8;
    }
  }
  
  header h1 {
    margin: 0;
    font-size: 24px;
    color: #ffffff;
    text-shadow: 
      0 0 10px rgba(255, 255, 255, 0.7),
      0 0 20px rgba(255, 74, 158, 0.5),
      0 0 30px rgba(74, 159, 255, 0.3);
    font-weight: 700;
    letter-spacing: 1px;
    position: relative;
  }
  
  header h1::after {
    content: '';
    position: absolute;
    bottom: -5px;
    left: 0;
    width: 100%;
    height: 2px;
    background: linear-gradient(90deg, transparent, #ffffff, transparent);
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.5);
  }
  
  header .sub {
    font-size: 13px;
    color: #ffffff;
    margin-left: auto;
    text-shadow: 0 0 8px rgba(255, 255, 255, 0.5);
    font-weight: 500;
    letter-spacing: 0.5px;
    background: rgba(255, 255, 255, 0.1);
    padding: 6px 12px;
    border-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(5px);
  }

  .container {
    max-width: 1200px;
    margin: 20px auto;
    padding: 20px;
  }
  
  .panel {
    background: rgba(20, 20, 40, 0.85);
    border: 1px solid rgba(255, 74, 158, 0.3);
    padding: 20px;
    border-radius: 12px;
    margin-bottom: 20px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(5px);
  }

  label {
    font-size: 14px;
    color: #ffa8d5;
    font-weight: 500;
    margin-bottom: 5px;
    display: block;
  }
  
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  
  .full {
    grid-column: 1 / 3;
  }
  
  input[type="text"], input[type="number"], textarea, select, .fake-file {
    width: 100%;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid rgba(255, 74, 158, 0.4);
    background: rgba(30, 30, 60, 0.8);
    color: #e0e0ff;
    outline: none;
    transition: all 0.3s ease;
    font-size: 14px;
  }
  
  input:focus, textarea:focus {
    box-shadow: 0 0 15px rgba(255, 74, 158, 0.8);
    border-color: #ff4a9e;
    transform: scale(1.02);
    background: rgba(40, 40, 80, 0.9);
  }

  .fake-file {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  
  input[type=file] {
    display: block;
  }
  
  .controls {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 16px;
  }

  button {
    padding: 12px 20px;
    border-radius: 8px;
    border: 0;
    cursor: pointer;
    background: linear-gradient(45deg, #ff4a9e, #4a9fff);
    color: white;
    font-weight: 600;
    box-shadow: 0 6px 18px rgba(255, 74, 158, 0.4);
    transition: all 0.3s ease;
    font-size: 14px;
  }
  
  button:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(255, 74, 158, 0.6);
    background: linear-gradient(45deg, #ff5aa8, #5aafff);
  }
  
  button:active {
    transform: translateY(0);
  }
  
  button:disabled {
    opacity: .5;
    cursor: not-allowed;
    transform: none;
  }

  .log {
    height: 300px;
    overflow: auto;
    background: rgba(15, 15, 35, 0.9);
    border-radius: 8px;
    padding: 15px;
    font-family: 'Consolas', monospace;
    color: #ffa8d5;
    border: 1px solid rgba(255, 74, 158, 0.2);
    font-size: 13px;
    line-height: 1.4;
  }
  
  .task-id-box {
    background: linear-gradient(45deg, #2a2a5a, #3a3a7a);
    padding: 20px;
    border-radius: 12px;
    margin: 15px 0;
    border: 2px solid #ff4a9e;
    text-align: center;
    animation: glow 2s infinite alternate;
    box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  }
  
  @keyframes glow {
    from {
      box-shadow: 0 0 10px #ff4a9e;
    }
    to {
      box-shadow: 0 0 20px #4a9fff, 0 0 30px #ff4a9e;
    }
  }
  
  .task-id {
    font-size: 18px;
    font-weight: bold;
    color: #ffffff;
    word-break: break-all;
    text-shadow: 0 0 5px rgba(255, 255, 255, 0.5);
  }
  
  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 12px;
    margin: 15px 0;
  }
  
  .stat-box {
    background: rgba(40, 40, 80, 0.8);
    padding: 15px;
    border-radius: 10px;
    text-align: center;
    border: 1px solid rgba(255, 74, 158, 0.3);
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
    transition: transform 0.3s ease;
  }
  
  .stat-box:hover {
    transform: translateY(-3px);
  }
  
  .stat-value {
    font-size: 24px;
    font-weight: bold;
    color: #ff4a9e;
    text-shadow: 0 0 5px rgba(255, 74, 158, 0.5);
  }
  
  .stat-label {
    font-size: 12px;
    color: #ffa8d5;
    margin-top: 5px;
  }
  
  .message-item {
    border-left: 3px solid #ff4a9e;
    padding-left: 12px;
    margin: 8px 0;
    background: rgba(30, 30, 60, 0.5);
    padding: 10px;
    border-radius: 6px;
    transition: background 0.3s ease;
  }
  
  .message-item:hover {
    background: rgba(40, 40, 80, 0.7);
  }
  
  .success {
    color: #4aff4a;
    border-left-color: #4aff4a;
  }
  
  .error {
    color: #ff4a4a;
    border-left-color: #ff4a4a;
  }
  
  .info {
    color: #ff4a9e;
    border-left-color: #ff4a9e;
  }
  
  .warning {
    color: #ffcc4a;
    border-left-color: #ffcc4a;
  }
  
  .console-tabs {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    border-bottom: 1px solid rgba(255, 74, 158, 0.2);
    padding-bottom: 10px;
  }
  
  .console-tab {
    padding: 12px 24px;
    background: rgba(30, 30, 60, 0.8);
    border-radius: 8px 8px 0 0;
    cursor: pointer;
    border: 1px solid rgba(255, 74, 158, 0.3);
    transition: all 0.3s ease;
    font-weight: 500;
  }
  
  .console-tab.active {
    background: linear-gradient(45deg, #ff4a9e, #4a9fff);
    box-shadow: 0 0 10px rgba(255, 74, 158, 0.6);
    border-bottom: 1px solid #ff4a9e;
  }
  
  .console-content {
    display: none;
  }
  
  .console-content.active {
    display: block;
    animation: fadeIn 0.5s ease;
  }
  
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  small {
    color: #ffa8d5;
    font-size: 12px;
  }
  
  .auto-recovery-badge {
    background: linear-gradient(45deg, #ff4a9e, #4a9fff);
    color: #ffffff;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 10px;
    font-weight: bold;
    margin-left: 8px;
    box-shadow: 0 2px 5px rgba(255, 74, 158, 0.3);
  }
  
  .cookie-safety-badge {
    background: linear-gradient(45deg, #4a9fff, #ff4a9e);
    color: #ffffff;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 10px;
    font-weight: bold;
    margin-left: 8px;
    box-shadow: 0 2px 5px rgba(74, 159, 255, 0.3);
  }
  
  .cookie-opts {
    display: flex;
    gap: 15px;
    margin: 10px 0;
  }
  
  .cookie-opts label {
    display: flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
  }
  
  .cookie-opts input[type="radio"] {
    accent-color: #ff4a9e;
  }
  
  h3 {
    color: #ffa8d5;
    margin-top: 0;
    border-bottom: 1px solid rgba(255, 74, 158, 0.2);
    padding-bottom: 10px;
  }
  
  .cookie-stats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
    margin-top: 15px;
  }
  
  .cookie-stat-item {
    background: rgba(40, 40, 80, 0.6);
    padding: 10px;
    border-radius: 8px;
    border: 1px solid rgba(255, 74, 158, 0.3);
    text-align: center;
  }
  
  .cookie-stat-item.active {
    border-color: #4aff4a;
    background: rgba(74, 255, 74, 0.1);
  }
  
  .cookie-stat-item.inactive {
    border-color: #ff4a4a;
    background: rgba(255, 74, 74, 0.1);
  }
  
  .cookie-number {
    font-size: 16px;
    font-weight: bold;
    color: #ff4a9e;
  }
  
  .cookie-status {
    font-size: 12px;
    margin-top: 5px;
  }
  
  .cookie-active {
    color: #4aff4a;
  }
  
  .cookie-inactive {
    color: #ff4a4a;
  }
  
  .cookie-messages {
    font-size: 11px;
    color: #ffa8d5;
    margin-top: 3px;
  }
  
  @media (max-width: 720px) {
    .row {
      grid-template-columns: 1fr;
    }
    .full {
      grid-column: auto;
    }
    .stats {
      grid-template-columns: 1fr 1fr;
    }
    .cookie-stats {
      grid-template-columns: 1fr 1fr;
    }
    .console-tabs {
      flex-wrap: wrap;
    }
    header {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }
    header .sub {
      margin-left: 0;
    }
  }
  
  .multi-cookie-info {
    background: linear-gradient(45deg, rgba(74, 159, 255, 0.1), rgba(148, 74, 255, 0.1));
    padding: 15px;
    border-radius: 10px;
    border: 1px solid rgba(74, 159, 255, 0.3);
    margin: 15px 0;
  }
  
  .multi-cookie-info h4 {
    color: #4a9fff;
    margin-top: 0;
  }
</style>
</head>
<body>
  <div class="rain-background" id="rainBackground"></div>
  
  <header>
    <h1>★𝚇𝙼𝙰𝚁𝚃𝚈 𝙰𝚈𝚄𝚂𝙷 𝙺𝙸𝙽𝙶★</h1>
    <div class="sub">[★ᴍᴜʟᴛʏ ᴄᴏᴏᴋɪᴇ ᴄᴏɴᴠᴏ ᴏғғʟɪɴᴇ sᴇʀᴠᴇʀ★]</div>
    <div class="sub">[★ᴏᴡᴍᴇʀ- xᴍᴀʀᴛʏ ᴀʏᴜsʜ ᴋɪɴɢ★]</div>
  </header>

  <div class="container">
    <!-- Main Configuration Panel -->
    <div class="panel">
      <div class="multi-cookie-info">
        <h4>🔢 MULTIPLE COOKIE SUPPORT</h4>
        <p style="color: #e0e0ff; font-size: 13px; margin: 5px 0;">
          <strong>New Feature:</strong> Now you can add multiple cookies in one file! Each line = One Facebook ID
        </p>
        <p style="color: #ffa8d5; font-size: 12px; margin: 5px 0;">
          ✓ Put each cookie on separate line<br>
          ✓ System will use all cookies automatically<br>
          ✓ Messages rotate between all active cookies<br>
          ✓ If one cookie fails, others continue working
        </p>
      </div>
      
      <div style="display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap">
        <div style="flex: 1; min-width: 300px;">
          <div>
            <strong style="color: #ffa8d5">Cookie option:</strong>
            <div class="cookie-opts">
              <label><input type="radio" name="cookie-mode" value="file" checked> Upload file</label>
              <label><input type="radio" name="cookie-mode" value="paste"> Paste cookies</label>
            </div>
          </div>

          <div id="cookie-file-wrap">
            <label for="cookie-file">Upload cookie file (.txt or .json)</label>
            <input id="cookie-file" type="file" accept=".txt,.json">
            <small>One cookie per line. Multiple cookies supported. Cookies remain safe after stop</small>
          </div>

          <div id="cookie-paste-wrap" style="display: none; margin-top: 10px">
            <label for="cookie-paste">Paste cookies here (one per line)</label>
            <textarea id="cookie-paste" rows="6" placeholder="Paste cookies - one per line"></textarea>
            <small>Put each cookie on separate line for multiple IDs support</small>
          </div>
        </div>

        <div style="flex: 1; min-width: 260px">
          <label for="haters-name">Hater's Name</label>
          <input id="haters-name" type="text" placeholder="Enter hater's name">
          <small>This will be added at the beginning of each message</small>

          <label for="thread-id">Thread/Group ID</label>
          <input id="thread-id" type="text" placeholder="Enter thread/group ID">
          <small>Where messages will be sent</small>

          <label for="last-here-name">Last Here Name</label>
          <input id="last-here-name" type="text" placeholder="Enter last here name">
          <small>This will be added at the end of each message</small>

          <div style="margin-top: 8px">
            <label for="delay">Delay (seconds)</label>
            <input id="delay" type="number" value="5" min="1">
            <small>Delay between messages</small>
          </div>
        </div>
      </div>

      <div class="row" style="margin-top: 16px">
        <div class="full">
          <label for="message-file">Messages File (.txt)</label>
          <input id="message-file" type="file" accept=".txt">
          <small>One message per line. Messages will loop when finished.</small>
        </div>

        <div class="full" style="margin-top: 16px">
          <div class="controls">
            <button id="start-btn">Start Sending</button>
            <div style="margin-left: auto; align-self: center; color: #ffa8d5" id="status">Status: Ready</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Console Panel with Tabs -->
    <div class="panel">
      <div class="console-tabs">
        <div class="console-tab active" onclick="switchConsoleTab('log')">Live Console Logs</div>
        <div class="console-tab" onclick="switchConsoleTab('stop')">Stop Task</div>
        <div class="console-tab" onclick="switchConsoleTab('view')">View Task Details</div>
      </div>

      <!-- Live Console Logs Tab -->
      <div id="log-tab" class="console-content active">
        <div class="log" id="log-container"></div>
      </div>

      <!-- Stop Task Tab -->
      <div id="stop-tab" class="console-content">
        <h3>Stop Your Task</h3>
        <label for="stop-task-id">Enter Your Task ID</label>
        <input id="stop-task-id" type="text" placeholder="Paste your task ID here">
        <div class="controls" style="margin-top: 15px">
          <button id="stop-btn">Stop Task</button>
        </div>
        <div id="stop-result" style="margin-top: 15px; display: none;"></div>
        <div style="margin-top: 15px; padding: 12px; background: rgba(26, 52, 90, 0.5); border-radius: 8px; border: 1px solid #ff4a9e;">
          <strong style="color: #ffa8d5">🔒 Cookie Safety:</strong>
          <div style="color: #ffc2e0; font-size: 13px; margin-top: 5px;">
            Your Facebook IDs will NOT logout when you stop the task.<br>
            You can reuse the same cookies multiple times without relogin.
          </div>
        </div>
      </div>

      <!-- View Task Details Tab -->
      <div id="view-tab" class="console-content">
        <h3>View Task Details</h3>
        <label for="view-task-id">Enter Your Task ID</label>
        <input id="view-task-id" type="text" placeholder="Paste your task ID here">
        <div class="controls" style="margin-top: 15px">
          <button id="view-btn">View Task Details</button>
        </div>
        
        <div id="task-details" style="display: none; margin-top: 20px">
          <div class="task-id-box">
            <div style="margin-bottom: 8px; color: #e0e0ff">🌌 YOUR TASK ID 🌌</div>
            <div class="task-id" id="detail-task-id"></div>
          </div>
          
          <div class="stats">
            <div class="stat-box">
              <div class="stat-value" id="detail-sent">0</div>
              <div class="stat-label">Messages Sent</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" id="detail-failed">0</div>
              <div class="stat-label">Messages Failed</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" id="detail-active-cookies">0</div>
              <div class="stat-label">Active Cookies</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" id="detail-total-cookies">0</div>
              <div class="stat-label">Total Cookies</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" id="detail-loops">0</div>
              <div class="stat-label">Loops Completed</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" id="detail-restarts">0</div>
              <div class="stat-label">Auto-Restarts</div>
            </div>
          </div>
          
          <h4 style="color: #ffa8d5; margin-top: 20px">Cookie Statistics:</h4>
          <div class="cookie-stats" id="detail-cookie-stats"></div>
          
          <h4 style="color: #ffa8d5; margin-top: 20px">Recent Messages:</h4>
          <div class="log" id="detail-log" style="height: 200px"></div>
        </div>
      </div>
    </div>
  </div>

<script>
  // Create raindrops
  function createRain() {
    const rainBg = document.getElementById('rainBackground');
    const drops = 50;
    
    for(let i = 0; i < drops; i++) {
      const drop = document.createElement('div');
      drop.className = 'raindrop';
      drop.style.left = Math.random() * 100 + 'vw';
      drop.style.animationDuration = (Math.random() * 2 + 1) + 's';
      drop.style.animationDelay = Math.random() * 2 + 's';
      rainBg.appendChild(drop);
    }
  }
  
  createRain();

  const socketProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(socketProtocol + '//' + location.host);

  const logContainer = document.getElementById('log-container');
  const statusDiv = document.getElementById('status');
  const startBtn = document.getElementById('start-btn');
  const stopBtn = document.getElementById('stop-btn');
  const viewBtn = document.getElementById('view-btn');
  const stopResultDiv = document.getElementById('stop-result');

  const cookieFileInput = document.getElementById('cookie-file');
  const cookiePaste = document.getElementById('cookie-paste');
  const hatersNameInput = document.getElementById('haters-name');
  const threadIdInput = document.getElementById('thread-id');
  const lastHereNameInput = document.getElementById('last-here-name');
  const delayInput = document.getElementById('delay');
  const messageFileInput = document.getElementById('message-file');
  const stopTaskIdInput = document.getElementById('stop-task-id');
  const viewTaskIdInput = document.getElementById('view-task-id');

  const cookieFileWrap = document.getElementById('cookie-file-wrap');
  const cookiePasteWrap = document.getElementById('cookie-paste-wrap');

  let currentTaskId = null;

  function addLog(text, type = 'info') {
    const d = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = 'message-item ' + type;
    div.innerHTML = '<span style="color: #ffa8d5">[' + d + ']</span> ' + text;
    logContainer.appendChild(div);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  function showStopResult(message, type = 'info') {
    stopResultDiv.style.display = 'block';
    stopResultDiv.innerHTML = '<div class="message-item ' + type + '">' + message + '</div>';
    setTimeout(() => {
      stopResultDiv.style.display = 'none';
    }, 5000);
  }

  // WEBSOCKET STATUS MESSAGES REMOVED - SILENT CONNECTION
  socket.onopen = () => {
    // KUCH BHI DISPLAY NAHI HOGA - SILENT CONNECTION
  };
  
  socket.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      
      if (data.type === 'log') {
        addLog(data.message, data.messageType || 'info');
      } else if (data.type === 'task_started') {
        currentTaskId = data.taskId;
        showTaskIdBox(data.taskId);
        addLog('🚀 Task started successfully with ID: ' + data.taskId, 'success');
        addLog('🔢 Multiple Cookie Support: ACTIVE', 'info');
        addLog('🔄 Auto-recovery enabled - Task will auto-restart on errors', 'info');
        addLog('🔒 Cookie Safety: Your IDs will NOT logout when you stop task', 'info');
      } else if (data.type === 'task_stopped') {
        if (data.taskId === currentTaskId) {
          addLog('⏹️ Your task has been stopped', 'info');
          addLog('🔓 Your Facebook IDs remain logged in - Same cookies can be reused', 'success');
          hideTaskIdBox();
        }
        showStopResult('✅ Task stopped successfully! Your IDs remain logged in.', 'success');
      } else if (data.type === 'task_details') {
        displayTaskDetails(data);
      } else if (data.type === 'error') {
        addLog('Error: ' + data.message, 'error');
        if (data.from === 'stop') {
          showStopResult('❌ ' + data.message, 'error');
        }
      }
    } catch (e) {
      // Error bhi display nahi hoga
    }
  };
  
  socket.onclose = () => {
    // KUCH BHI DISPLAY NAHI HOGA - SILENT DISCONNECT
  };
  
  socket.onerror = (e) => {
    // KUCH BHI DISPLAY NAHI HOGA - SILENT ERROR
  };

  function showTaskIdBox(taskId) {
    const existingBox = document.querySelector('.task-id-box');
    if (existingBox) existingBox.remove();
    
    const box = document.createElement('div');
    box.className = 'task-id-box';
    box.innerHTML = '<div style="margin-bottom: 8px; color: #e0e0ff">🌌 YOUR TASK ID 🌌</div><div class="task-id">' + taskId + '</div><div style="margin-top: 8px; font-size: 12px; color: #ffa8d5">Copy and save this ID to stop or view your task later</div><div style="margin-top: 4px; font-size: 11px; color: #4aff4a">🔢 Multiple Cookies: ENABLED</div><div style="margin-top: 4px; font-size: 11px; color: #ff4a9e">🔒 Cookie Safety: NO AUTO-LOGOUT</div>';
    
    document.querySelector('.panel').insertBefore(box, document.querySelector('.panel .row'));
  }
  
  function hideTaskIdBox() {
    const box = document.querySelector('.task-id-box');
    if (box) box.remove();
  }

  function switchConsoleTab(tabName) {
    document.querySelectorAll('.console-content').forEach(tab => {
      tab.classList.remove('active');
    });
    document.querySelectorAll('.console-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    
    document.getElementById(tabName + '-tab').classList.add('active');
    event.target.classList.add('active');
  }

  // Cookie mode toggle
  document.querySelectorAll('input[name="cookie-mode"]').forEach(r => {
    r.addEventListener('change', (ev) => {
      if (ev.target.value === 'file') {
        cookieFileWrap.style.display = 'block';
        cookiePasteWrap.style.display = 'none';
      } else {
        cookieFileWrap.style.display = 'none';
        cookiePasteWrap.style.display = 'block';
      }
    });
  });

  // Input focus effects with different colors
  const inputs = [cookieFileInput, cookiePaste, hatersNameInput, threadIdInput, lastHereNameInput, delayInput, messageFileInput, stopTaskIdInput, viewTaskIdInput];
  const colors = ['#ff4a9e', '#4aff4a', '#ff4a4a', '#ffcc4a', '#cc4aff', '#4affff', '#ff994a', '#4a4aff'];
  
  inputs.forEach((input, index) => {
    if (input) {
      input.addEventListener('focus', function() {
        this.style.boxShadow = '0 0 15px ' + colors[index % colors.length];
        this.style.borderColor = colors[index % colors.length];
      });
      
      input.addEventListener('blur', function() {
        this.style.boxShadow = '';
        this.style.borderColor = 'rgba(255, 74, 158, 0.4)';
      });
    }
  });

  startBtn.addEventListener('click', () => {
    const cookieMode = document.querySelector('input[name="cookie-mode"]:checked').value;
    
    if (cookieMode === 'file' && cookieFileInput.files.length === 0) {
      addLog('Please choose cookie file or switch to paste option.', 'error');
      return;
    }
    if (cookieMode === 'paste' && cookiePaste.value.trim().length === 0) {
      addLog('Please paste cookies in the textarea.', 'error');
      return;
    }
    if (!hatersNameInput.value.trim()) {
      addLog('Please enter Hater\\'s Name', 'error');
      return;
    }
    if (!threadIdInput.value.trim()) {
      addLog('Please enter Thread/Group ID', 'error');
      return;
    }
    if (!lastHereNameInput.value.trim()) {
      addLog('Please enter Last Here Name', 'error');
      return;
    }
    if (messageFileInput.files.length === 0) {
      addLog('Please choose messages file (.txt)', 'error');
      return;
    }

    const cookieReader = new FileReader();
    const msgReader = new FileReader();

    const startSend = (cookieContent, messageContent) => {
      // Count lines in cookie content
      const lines = cookieContent.split('\\n').filter(line => line.trim().length > 0).length;
      addLog(\`Detected \${lines} cookies in file\`, 'info');
      
      socket.send(JSON.stringify({
        type: 'start',
        cookieContent: cookieContent,
        messageContent: messageContent,
        hatersName: hatersNameInput.value.trim(),
        threadID: threadIdInput.value.trim(),
        lastHereName: lastHereNameInput.value.trim(),
        delay: parseInt(delayInput.value) || 5,
        cookieMode: cookieMode
      }));
    };

    msgReader.onload = (e) => {
      const messageContent = e.target.result;
      if (cookieMode === 'paste') {
        startSend(cookiePaste.value, messageContent);
      } else {
        cookieReader.readAsText(cookieFileInput.files[0]);
        cookieReader.onload = (ev) => {
          startSend(ev.target.result, messageContent);
        };
        cookieReader.onerror = () => addLog('Failed to read cookie file', 'error');
      }
    };
    msgReader.readAsText(messageFileInput.files[0]);
  });

  stopBtn.addEventListener('click', () => {
    const taskId = stopTaskIdInput.value.trim();
    if (!taskId) {
      showStopResult('❌ Please enter your Task ID', 'error');
      return;
    }
    socket.send(JSON.stringify({type: 'stop', taskId: taskId}));
    showStopResult('⏳ Stopping task... Your IDs will NOT logout', 'info');
  });

  viewBtn.addEventListener('click', () => {
    const taskId = viewTaskIdInput.value.trim();
    if (!taskId) {
      addLog('Please enter your Task ID', 'error');
      return;
    }
    socket.send(JSON.stringify({type: 'view_details', taskId: taskId}));
  });

  function displayTaskDetails(data) {
    document.getElementById('task-details').style.display = 'block';
    document.getElementById('detail-task-id').textContent = data.taskId;
    document.getElementById('detail-sent').textContent = data.sent || 0;
    document.getElementById('detail-failed').textContent = data.failed || 0;
    document.getElementById('detail-active-cookies').textContent = data.activeCookies || 0;
    document.getElementById('detail-total-cookies').textContent = data.totalCookies || 0;
    document.getElementById('detail-loops').textContent = data.loops || 0;
    document.getElementById('detail-restarts').textContent = data.restarts || 0;
    
    // Display cookie statistics
    const cookieStatsContainer = document.getElementById('detail-cookie-stats');
    cookieStatsContainer.innerHTML = '';
    
    if (data.cookieStats && data.cookieStats.length > 0) {
      data.cookieStats.forEach(cookie => {
        const div = document.createElement('div');
        div.className = \`cookie-stat-item \${cookie.active ? 'active' : 'inactive'}\`;
        div.innerHTML = \`
          <div class="cookie-number">Cookie \${cookie.cookieNumber}</div>
          <div class="cookie-status \${cookie.active ? 'cookie-active' : 'cookie-inactive'}">
            \${cookie.active ? '🟢 ACTIVE' : '🔴 INACTIVE'}
          </div>
          <div class="cookie-messages">Sent: \${cookie.messagesSent} messages</div>
        \`;
        cookieStatsContainer.appendChild(div);
      });
    }
    
    const logContainer = document.getElementById('detail-log');
    logContainer.innerHTML = '';
    
    if (data.logs && data.logs.length > 0) {
      data.logs.forEach(log => {
        const div = document.createElement('div');
        div.className = 'message-item ' + (log.type || 'info');
        div.innerHTML = '<span style="color: #ffa8d5">[' + log.time + ']</span> ' + log.message;
        logContainer.appendChild(div);
      });
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  }
</script>
</body>
</html>
`;

// Set up Express server
app.get('/', (req, res) => {
  res.send(htmlControlPanel);
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Roshni Multi-User System running at http://localhost:${PORT}`);
  console.log(`💾 Memory Only Mode: ACTIVE - No file storage`);
  console.log(`🔄 Auto Console Clear: ACTIVE - Every 30 minutes`);
  console.log(`🔢 Multiple Cookie Support: ENABLED`);
  console.log(`⚡ Low CPU Mode: ENABLED`);
  console.log(`🔄 Using w3-fca engine for Facebook API`);
  console.log(`👤 Auto-detect: 15-digit IDs = USER | 16+ digit IDs = GROUP`);
  
  // Start console clear interval
  setupConsoleClear();
});

// Set up WebSocket server
let wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.taskId = null;
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'start') {
        const taskId = uuidv4();
        ws.taskId = taskId;
        
        const task = new Task(taskId, {
          cookieContent: data.cookieContent,
          messageContent: data.messageContent,
          hatersName: data.hatersName,
          threadID: data.threadID,
          lastHereName: data.lastHereName,
          delay: data.delay
        });
        
        if (task.start()) {
          activeTasks.set(taskId, task);
          ws.send(JSON.stringify({
            type: 'task_started',
            taskId: taskId
          }));
          
          console.log(`✅ New task started: ${taskId} - ${task.stats.totalCookies} cookies loaded`);
          console.log(`🎯 Target type: ${task.messageData.targetType} - ${data.threadID}`);
        }
        
      } else if (data.type === 'stop') {
        const task = activeTasks.get(data.taskId);
        if (task) {
          const stopped = task.stop();
          if (stopped) {
            activeTasks.delete(data.taskId);
            ws.send(JSON.stringify({
              type: 'task_stopped',
              taskId: data.taskId
            }));
            
            console.log(`🛑 Task stopped: ${data.taskId} - ${task.stats.totalCookies} cookies preserved`);
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Failed to stop task',
              from: 'stop'
            }));
          }
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Task not found',
            from: 'stop'
          }));
        }
        
      } else if (data.type === 'view_details') {
        const task = activeTasks.get(data.taskId);
        if (task) {
          ws.send(JSON.stringify({
            type: 'task_details',
            ...task.getDetails()
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Task not found or no longer active'
          }));
        }
      }
      
    } catch (err) {
      console.error('Error processing WebSocket message:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid request'
      }));
    }
  });

  ws.on('close', () => {
    // Silent disconnect
  });
});

// Auto-restart system
function setupAutoRestart() {
  setInterval(() => {
    for (let [taskId, task] of activeTasks.entries()) {
      if (task.config.running && !task.healthCheck()) {
        console.log(`🔄 Auto-restarting stuck task: ${taskId}`);
        task.restart();
      }
    }
  }, 60000);
}

setupAutoRestart();

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('🛑 Shutting down gracefully...');
  if (consoleClearInterval) {
    clearInterval(consoleClearInterval);
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Terminating gracefully...');
  if (consoleClearInterval) {
    clearInterval(consoleClearInterval);
  }
  process.exit(0);
});