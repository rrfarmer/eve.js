const fs = require("fs");
const path = require("path");
const http = require("http");
const net = require("net");
const http2 = require("http2");
const crypto = require("crypto");

const config = require("../../config");
const log = require("../../utils/logger");
const { handleGatewayStream } = require("./publicGatewayLocal");

function shouldEnableLocalInterceptByDefault() {
  try {
    const redirectUrl = new URL(config.microservicesRedirectUrl);
    return isLoopbackHost(redirectUrl.hostname);
  } catch {
    return false;
  }
}

function parseBooleanEnv(value, fallback = false) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

const ENABLE_LOCAL_INTERCEPT = parseBooleanEnv(
  process.env.EVEJS_PROXY_LOCAL_INTERCEPT,
  shouldEnableLocalInterceptByDefault(),
);
const EXPRESS_PROXY_ENABLED = parseBooleanEnv(
  process.env.EVEJS_EXPRESS_PROXY_ENABLED,
  true,
);
const LOCAL_INTERCEPT_HOSTS = new Set([
  "dev-public-gateway.evetech.net",
  "public-gateway.evetech.net",
]);

function shouldInterceptHost(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return LOCAL_INTERCEPT_HOSTS.has(normalized);
}

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

const COPYCAT_XML_RESPONSE = `<?xml version="1.0" encoding="utf-8"?>\n<copycat />\n`;
const COPYCAT_INI_RESPONSE = "autosave=3\ndatabase=copycat.xml\n";

function tryServeInsiderAsset(res, targetUrl) {
  if (!targetUrl) {
    return false;
  }

  const hostname = String(targetUrl.hostname || "").trim().toLowerCase();
  const pathname = String(targetUrl.pathname || "").trim();

  if (hostname !== "content.eveonline.com") {
    return false;
  }

  if (pathname === "/QA/insider/copycat.xml") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/xml; charset=utf-8");
    res.end(COPYCAT_XML_RESPONSE);
    return true;
  }

  if (pathname === "/QA/insider/copycat.ini") {
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(COPYCAT_INI_RESPONSE);
    return true;
  }

  return false;
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

function loadLocalTlsOptions() {
  const certDir = path.join(__dirname, "./certs");
  const gatewayLeafCertPath = path.join(certDir, "gateway-dev-cert.pem");
  const gatewayLeafKeyPath = path.join(certDir, "gateway-dev-key.pem");
  const pfxPath = path.join(certDir, "gateway-dev.pfx");
  const passphrasePath = path.join(certDir, "gateway-dev-passphrase.txt");
  const certPath = path.join(certDir, "gateway-dev-cert.pem");

  if (fs.existsSync(gatewayLeafCertPath) && fs.existsSync(gatewayLeafKeyPath)) {
    return {
      tlsOptions: {
        key: fs.readFileSync(gatewayLeafKeyPath),
        cert: fs.readFileSync(gatewayLeafCertPath),
        allowHTTP1: true,
        ALPNProtocols: ["h2", "http/1.1"],
      },
      certPem: fs.readFileSync(gatewayLeafCertPath),
    };
  }

  if (fs.existsSync(pfxPath)) {
    return {
      tlsOptions: {
        pfx: fs.readFileSync(pfxPath),
        passphrase: fs.existsSync(passphrasePath)
          ? fs.readFileSync(passphrasePath, "utf8").trim()
          : "",
        allowHTTP1: true,
        ALPNProtocols: ["h2", "http/1.1"],
      },
      certPem: fs.existsSync(certPath) ? fs.readFileSync(certPath) : null,
    };
  }

  const legacyCertPath = path.join(certDir, "cert.pem");
  const legacyKeyPath = path.join(certDir, "key.pem");
  return {
    tlsOptions: {
      key: fs.readFileSync(legacyKeyPath),
      cert: fs.readFileSync(legacyCertPath),
      allowHTTP1: true,
      ALPNProtocols: ["h2", "http/1.1"],
    },
    certPem: fs.readFileSync(legacyCertPath),
  };
}

function createLocalSecureResponder(httpsPort) {
  const { tlsOptions, certPem } = loadLocalTlsOptions();

  try {
    if (certPem) {
      const x509 = new crypto.X509Certificate(certPem);
      log.debug(
        `[local https cert] subject=${x509.subject} issuer=${x509.issuer} validTo=${x509.validTo}`,
      );
    }
  } catch (err) {
    console.error("[LOCAL HTTPS CERT PARSE ERROR]", err.message);
  }

  const secureServer = http2.createSecureServer(tlsOptions);

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

    stream.on("error", (err) => {
      console.error("[LOCAL HTTP2 STREAM ERROR]", err.message);
    });

    if (contentType.includes("application/grpc") && handleGatewayStream(stream, headers)) {
      return;
    }

    let bodyLength = 0;
    stream.on("data", (chunk) => {
      bodyLength += chunk.length;
    });

    stream.on("end", () => {
      console.log("BODY BYTES:", bodyLength);
    });

    if (contentType.includes("application/grpc")) {
      stream.respond(
        {
          ":status": 200,
          "content-type": "application/grpc+proto",
          "grpc-encoding": "identity",
          "grpc-accept-encoding": "identity",
        },
        { waitForTrailers: true },
      );
      stream.on("wantTrailers", () => {
        try {
          stream.sendTrailers({
            "grpc-status": "12",
            "grpc-message": encodeURIComponent(
              `eve.js local gateway has no handler for ${routePath}`,
            ),
          });
        } catch (err) {
          console.error("[LOCAL HTTP2 TRAILER ERROR]", err.message);
        }
      });
      stream.end();
      return;
    }

    stream.respond({
      ":status": 200,
      "content-type": "application/json",
    });
    stream.end(JSON.stringify(makeHttp2Payload(headers)));
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

    if (tryServeInsiderAsset(res, targetUrl)) {
      return;
    }
    
    if (targetUrl && ENABLE_LOCAL_INTERCEPT && shouldInterceptHost(targetUrl.hostname)) {
      console.log(
        `[HTTP PROXY INTERCEPT] ${req.method} ${targetUrl.href} -> LOCAL STUB`,
      );
      next();
      return;
    }

    if (targetUrl) {
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
    createLocalSecureResponder(httpsPort);
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

    const interceptLocal = ENABLE_LOCAL_INTERCEPT && shouldInterceptHost(host);
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

  log.debug(
    `express proxy mode: ${
      ENABLE_LOCAL_INTERCEPT ? "local intercept enabled" : "transparent forward"
    }`,
  );
}

module.exports = {
  enabled: EXPRESS_PROXY_ENABLED,
  serviceName: "expressServer",
  exec() {
    startServer();
    log.debug(`express server is running on ${config.microservicesRedirectUrl}`);
  },
};
