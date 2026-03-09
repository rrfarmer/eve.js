const fs = require("fs");
const path = require("path");
const http = require("http");
const net = require("net");
const http2 = require("http2");
const crypto = require("crypto");

const config = require("../../config");
const log = require("../../utils/logger");

const ENABLE_LOCAL_INTERCEPT = false;
const LOCAL_INTERCEPT_HOSTS = new Set(["dev-public-gateway.evetech.net"]);

function makeResponsePayload(req) {
  return {
    status: "ok",
    message: "microservice placeholder response",
    method: req.method,
    path: req.originalUrl || req.url,
    host: req.headers.host || null,
    timestamp: new Date().toISOString(),
  };
}

function makeHttp2Payload(headers) {
  return {
    status: "ok",
    message: "microservice placeholder response",
    method: headers[":method"] || null,
    path: headers[":path"] || null,
    host: headers[":authority"] || headers.host || null,
    timestamp: new Date().toISOString(),
  };
}

function parseConnectTarget(connectUrl) {
  const raw = String(connectUrl || "").trim();
  if (!raw) {
    return { host: null, port: null };
  }

  const idx = raw.lastIndexOf(":");
  if (idx === -1) {
    return { host: raw.toLowerCase(), port: 443 };
  }

  const host = raw.slice(0, idx).toLowerCase();
  const parsedPort = Number.parseInt(raw.slice(idx + 1), 10);
  return {
    host,
    port: Number.isFinite(parsedPort) ? parsedPort : 443,
  };
}

function parseHttpProxyTarget(req) {
  const rawUrl = String(req.url || "");
  if (/^https?:\/\//i.test(rawUrl)) {
    try {
      return new URL(rawUrl);
    } catch {
      return null;
    }
  }
  return null;
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function pipeHttpProxyRequest(req, res, targetUrl) {
  const targetHost = targetUrl.hostname;
  const targetPort =
    Number.parseInt(targetUrl.port || "", 10) ||
    (targetUrl.protocol === "https:" ? 443 : 80);

  const headers = { ...req.headers };
  headers.host = targetUrl.host;
  delete headers["proxy-connection"];

  console.log(
    `[HTTP PROXY FORWARD] ${req.method} ${targetUrl.href} -> ${targetHost}:${targetPort}`,
  );

  const upstreamReq = http.request(
    {
      host: targetHost,
      port: targetPort,
      method: req.method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers,
    },
    (upstreamRes) => {
      res.statusCode = upstreamRes.statusCode || 502;
      for (const [k, v] of Object.entries(upstreamRes.headers)) {
        if (typeof v !== "undefined") {
          res.setHeader(k, v);
        }
      }
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on("error", (err) => {
    console.error(
      `[HTTP PROXY FORWARD ERROR] ${targetUrl.href} ${err.message}`,
    );
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader("content-type", "text/plain");
    }
    res.end("Bad Gateway");
  });

  req.pipe(upstreamReq);
}

function createLocalSecureResponder(httpsPort, app) {
  const certPath = path.join(__dirname, "./certs/cert.pem");
  const keyPath = path.join(__dirname, "./certs/key.pem");
  const certPem = fs.readFileSync(certPath);

  const tlsOptions = {
    key: fs.readFileSync(keyPath),
    cert: certPem,
    allowHTTP1: true,
    ALPNProtocols: ["h2", "http/1.1"],
  };

  try {
    const x509 = new crypto.X509Certificate(certPem);
    log.debug(
      `[local https cert] subject=${x509.subject} issuer=${x509.issuer} validTo=${x509.validTo}`,
    );
  } catch (err) {
    console.error("[LOCAL HTTPS CERT PARSE ERROR]", err.message);
  }

  const secureServer = http2.createSecureServer(tlsOptions, app);

  secureServer.on("connection", (socket) => {
    console.log(
      `[LOCAL HTTPS TCP CONNECTION] ${socket.remoteAddress}:${socket.remotePort}`,
    );
  });

  secureServer.on("secureConnection", (tlsSocket) => {
    console.log(
      "[LOCAL HTTPS SECURE CONNECTION]",
      tlsSocket.remoteAddress,
      "ALPN=",
      tlsSocket.alpnProtocol || "none",
    );
  });

  secureServer.on("stream", (stream, headers) => {
    const method = headers[":method"] || "";
    const routePath = headers[":path"] || "";
    const authority = headers[":authority"] || headers.host || "";
    const contentType = String(headers["content-type"] || "");

    console.log("---- LOCAL HTTP2 STREAM ----");
    console.log("METHOD:", method);
    console.log("PATH:", routePath);
    console.log("AUTHORITY:", authority);
    console.log("CONTENT-TYPE:", contentType || "<none>");

    let bodyLength = 0;
    stream.on("data", (chunk) => {
      bodyLength += chunk.length;
    });

    stream.on("end", () => {
      console.log("BODY BYTES:", bodyLength);
    });

    stream.on("error", (err) => {
      console.error("[LOCAL HTTP2 STREAM ERROR]", err.message);
    });

    if (contentType.includes("application/grpc")) {
      stream.respond({
        ":status": 200,
        "content-type": "application/grpc+proto",
        "grpc-encoding": "identity",
        "grpc-accept-encoding": "identity",
        "grpc-status": "0",
      });
      stream.end(Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]));
      return;
    }

    stream.respond({
      ":status": 200,
      "content-type": "application/json",
    });
    stream.end(JSON.stringify(makeHttp2Payload(headers)));
  });

  secureServer.on("request", (req, res) => {
    console.log("---- LOCAL HTTPS HTTP1 REQUEST ----");
    console.log("METHOD:", req.method);
    console.log("PATH:", req.url);

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(makeResponsePayload(req)));
  });

  secureServer.on("sessionError", (err) => {
    console.error("[LOCAL HTTP2 SESSION ERROR]", err.message);
  });

  secureServer.on("tlsClientError", (err) => {
    console.error(
      "[LOCAL HTTPS TLS ERROR]",
      err.message,
      "code=",
      err.code || "n/a",
    );
  });

  secureServer.on("error", (err) => {
    console.error("[LOCAL HTTPS SERVER ERROR]", err.message);
  });

  secureServer.listen(httpsPort, "127.0.0.1", () => {
    log.debug(`local https responder listening on 127.0.0.1:${httpsPort}`);
  });
}

function wireTunnel(clientSocket, upstreamSocket, head, label) {
  let upBytes = 0;
  let downBytes = 0;

  clientSocket.setNoDelay(true);
  upstreamSocket.setNoDelay(true);

  if (head && head.length > 0) {
    upstreamSocket.write(head);
    upBytes += head.length;
  }

  clientSocket.on("data", (chunk) => {
    upBytes += chunk.length;
  });

  upstreamSocket.on("data", (chunk) => {
    downBytes += chunk.length;
  });

  upstreamSocket.pipe(clientSocket);
  clientSocket.pipe(upstreamSocket);

  upstreamSocket.setTimeout(30000);

  upstreamSocket.on("timeout", () => {
    console.error(
      `[PROXY TUNNEL TIMEOUT] ${label} up=${upBytes} down=${downBytes}`,
    );
    upstreamSocket.destroy();
    clientSocket.destroy();
  });

  upstreamSocket.on("close", () => {
    console.log(
      `[PROXY TUNNEL CLOSE upstream] ${label} up=${upBytes} down=${downBytes}`,
    );
  });

  clientSocket.on("close", () => {
    console.log(
      `[PROXY TUNNEL CLOSE client] ${label} up=${upBytes} down=${downBytes}`,
    );
  });

  upstreamSocket.on("error", (err) => {
    console.error(`[PROXY TUNNEL upstream error] ${label}`, err.message);
    clientSocket.destroy();
  });

  clientSocket.on("error", (err) => {
    console.error(`[PROXY TUNNEL client error] ${label}`, err.message);
    upstreamSocket.destroy();
  });
}

function startServer() {
  const express = require("express");
  const app = express();

  app.use((req, res, next) => {
    const targetUrl = parseHttpProxyTarget(req);
    const shouldForwardLoopbackImage =
      targetUrl &&
      isLoopbackHost(targetUrl.hostname) &&
      Number.parseInt(targetUrl.port || "80", 10) === 26001;

    if (shouldForwardLoopbackImage) {
      pipeHttpProxyRequest(req, res, targetUrl);
      return;
    }

    console.log("---- HTTP REQUEST ----");
    console.log("URL:", req.url);
    console.log("METHOD:", req.method);
    console.log("HEADERS:", req.headers);
    console.log("----------------------");
    next();
  });

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", service: "express-secondary" });
  });

  app.all(/.*/, (req, res) => {
    res.status(200).json(makeResponsePayload(req));
  });

  const redirectUrl = new URL(config.microservicesRedirectUrl);
  const httpPort = Number.parseInt(redirectUrl.port, 10);
  const httpsPort = httpPort + 1;

  if (ENABLE_LOCAL_INTERCEPT) {
    createLocalSecureResponder(httpsPort, app);
  }

  const proxyServer = http.createServer(app);

  proxyServer.on("connect", (req, clientSocket, head) => {
    const targetRaw = req.url || "";
    const { host, port } = parseConnectTarget(targetRaw);

    if (!host || !port) {
      clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      clientSocket.destroy();
      return;
    }

    const interceptLocal = ENABLE_LOCAL_INTERCEPT && LOCAL_INTERCEPT_HOSTS.has(host);
    const connectHost = interceptLocal ? "127.0.0.1" : host;
    const connectPort = interceptLocal ? httpsPort : port;

    console.log(
      `[HTTPS CONNECT] ${targetRaw} -> ${interceptLocal ? "LOCAL" : "REMOTE"} ${connectHost}:${connectPort}`,
    );

    const upstreamSocket = net.connect(connectPort, connectHost, () => {
      clientSocket.write(
        "HTTP/1.1 200 Connection Established\r\n" +
        "Proxy-Agent: eve.js\r\n" +
        "\r\n",
      );

      wireTunnel(
        clientSocket,
        upstreamSocket,
        head,
        `${targetRaw} via ${connectHost}:${connectPort}`,
      );
    });

    upstreamSocket.on("error", (err) => {
      console.error(
        `[PROXY serverSocket ERROR] ${connectHost}:${connectPort}`,
        err.message,
      );
      if (!clientSocket.destroyed) {
        clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      }
      clientSocket.destroy();
    });
  });

  proxyServer.on("error", (err) => {
    console.error("[PROXY SERVER ERROR]", err.message);
  });

  proxyServer.listen(httpPort, "127.0.0.1");
}

module.exports = {
  enabled: false,
  serviceName: "expressServer",
  exec() {
    startServer();
    log.debug(`express server is running on ${config.microservicesRedirectUrl}`);
  },
};
