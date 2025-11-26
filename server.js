const express = require('express');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

let ffmpeg = null;
let clients = []; // HTTP audio clients

// Start ffmpeg when first WS client connects. We'll feed raw PCM from ESP32 into ffmpeg stdin.
// Adjust sample rate/format as used on ESP32.
function startFFmpeg() {
  if (ffmpeg) return;
  // ffmpeg arguments: raw 16-bit LE PCM mono at 16k -> encode to mp3 (or pipe out as mp3)
  ffmpeg = spawn('ffmpeg', [
    '-f', 's16le',         // input format: signed 16-bit little endian
    '-ar', '16000',        // input sample rate
    '-ac', '1',            // channels
    '-i', 'pipe:0',        // input from stdin
    '-f', 'mp3',           // output format
    '-vn',
    'pipe:1'               // output to stdout
  ]);

  ffmpeg.stderr.on('data', d => {
    // ffmpeg logs to stderr
    console.error('ffmpeg:', d.toString());
  });

  ffmpeg.on('exit', (code) => {
    console.log('ffmpeg exited', code);
    ffmpeg = null;
  });

  // When ffmpeg outputs audio, stream to connected HTTP clients
  ffmpeg.stdout.on('data', chunk => {
    clients.forEach(res => {
      try { res.write(chunk); } catch(e) { /* ignore individual errors */ }
    });
  });
}

// WebSocket audio input
wss.on('connection', ws => {
  console.log('WS client connected');
  ws.on('message', (msg) => {
    // msg is a Buffer containing raw PCM from ESP32
    if (!ffmpeg) startFFmpeg();
    if (ffmpeg && ffmpeg.stdin.writable) {
      ffmpeg.stdin.write(msg);
    }
  });
  ws.on('close', () => { console.log('WS client disconnected'); });
});

// HTTP endpoint to serve live mp3
app.get('/live.mp3', (req, res) => {
  res.set({
    'Content-Type': 'audio/mpeg',
    'Connection': 'keep-alive',
    'Transfer-Encoding': 'chunked'
  });
  clients.push(res);
  req.on('close', () => {
    clients = clients.filter(c => c !== res);
  });
});

const PORT = 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
