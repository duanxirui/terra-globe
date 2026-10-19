#!/usr/bin/env node
'use strict';

// A dependency-free static server for local development (npm run dev / node server.cjs).
// The port defaults to 4173 and falls back to 4174 / 4175 when busy;
// set the PORT environment variable to force a specific port.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const DEFAULT_PORT = 4173;
const FALLBACK_PORTS = [4174, 4175];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function resolveFile(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  const target = path.normalize(path.join(ROOT, pathname));
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) return path.join(target, 'index.html');
  return target;
}

const server = http.createServer((request, response) => {
  const filePath = resolveFile(request.url);
  if (!filePath) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('403 Forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      // Development server: always serve the latest files.
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  });
});

const forcedPort = Number(process.env.PORT);
const candidates = Number.isInteger(forcedPort) && forcedPort > 0 ? [forcedPort] : [DEFAULT_PORT, ...FALLBACK_PORTS];

function listen(index) {
  if (index >= candidates.length) {
    console.error('端口 4173 / 4174 / 4175 均被占用，请通过环境变量 PORT 指定可用端口。');
    process.exit(1);
  }
  const port = candidates[index];
  const onError = (error) => {
    if (error.code === 'EADDRINUSE' && candidates.length > 1) {
      console.warn(`端口 ${port} 已被占用，尝试 ${candidates[index + 1]}…`);
      startNext(index);
    } else {
      console.error(`无法在端口 ${port} 启动：${error.message}`);
      process.exit(1);
    }
  };
  const onListening = () => {
    server.removeListener('error', onError);
    console.log(`TERRA 开发服务器运行中：http://localhost:${port}`);
    console.log('按 Ctrl+C 停止。');
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port);
}

function startNext(index) {
  server.removeAllListeners('listening');
  listen(index + 1);
}

listen(0);
