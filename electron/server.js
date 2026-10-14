const os = require("os");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const multer = require("multer");
const { Bonjour } = require("bonjour-service");
const cors = require("cors");
const express = require("express");
const crypto = require("crypto");

const PORT = 45678;
const SERVICE_TYPE = "flash";

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    //console.log(name)
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}
function isLoopbackAddress(address = "") {
  return (
    address === "::1" ||
    address === "127.0.0.1" ||
    address.startsWith("::ffff:127.")
  );
}

function getBearerToken(req) {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer (.+)$/i);
  return match ? match[1] : null;
}

function getReceivedDir() {
  const dir = path.join(os.homedir(), "Downloads", "FlashReceived");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDeviceInfo() {
  const ip = getLocalIP();
  return {
    name: os.hostname(),
    type: "desktop",
    ip,
    port: PORT,
    url: `http://${ip}:${PORT}`,
  };
}

function startServer() {
  const app = express();
  const recieveDir = getReceivedDir();
  const device = getDeviceInfo();
  const pairingCode = String(crypto.randomInt(100000, 1000000));
  const pairedTokens = new Map();
  const failedAttempts = new Map();
  const discoveredDevices = new Map();


  console.log(`Flash pairing code for ${device.name}: ${pairingCode}`);

  app.use(cors());
  app.use(express.json());

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, recieveDir),
    filename: (_req, file, cb) => {
      const safe = path
        .basename(file.originalname)
        .replace(/[<>:"/\\|?*]/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  });

  const upload = multer({ storage });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/info", (_req, res) => {
    res.json(device);
  });

  app.get("/", (req, res)=>{
    res.send(`
        Hello welcome to Flash, a file transfer
        application.
        \n
        Test the application with the following endpoints\n
        1. ${device.url}/health
        2. ${device.url}/upload
        3. ${device.url}/info
        `)
  })

  app.get("/qr", async (_req, res) => {
    try {
      const payload = JSON.stringify({
        name: device.name,
        ip: device.ip,
        port: device.port,
        url: device.url,
      });
      const dataUrl = await QRCode.toDataURL(payload);
      res.json({ payload, dataUrl });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
  app.get("/pairing-code", (req, res) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      return res.status(403).json({ error: "Local access only" });
    }

    res.json({ code: pairingCode });
  });

  app.get("/devices", (_req, res) => {
    res.json([...discoveredDevices.values()]);
  });

  app.post("/pair", (req, res) => {
    const clientAddress = req.ip;
    const attempt = failedAttempts.get(clientAddress);
    const now = Date.now();

    if (attempt && attempt.blockedUntil > now) {
      return res
        .status(429)
        .json({ error: "Too many incorrect codes. Try again later." });
    }

    if (req.body.code !== pairingCode) {
      const failures = (attempt?.failures || 0) + 1;
      failedAttempts.set(clientAddress, {
        failures,
        blockedUntil: failures >= 5 ? now + 60_000 : 0,
      });
      return res.status(401).json({ error: "Incorrect pairing code" });
    }

    failedAttempts.delete(clientAddress);

    const token = crypto.randomBytes(32).toString("hex");
    pairedTokens.set(token, Date.now() + 12 * 60 * 60 * 1000);

    res.json({ ok: true, token });
  });
  app.post(
    "/upload",
    (req, res, next) => {
      const token = getBearerToken(req);
      const expiresAt = token && pairedTokens.get(token);

      if (!expiresAt || expiresAt < Date.now()) {
        if (token) pairedTokens.delete(token);
        return res
          .status(401)
          .json({ error: "Pair with this device before sending files" });
      }

      next();
    },
    upload.array("files", 50),
    (req, res) => {
      const files = (req.files || []).map((file) => ({
        name: file.originalname,
        savedAs: file.filename,
        size: file.size,
        path: file.path,
      }));
      console.log("Received Files: ", files);
      res.json({ ok: true, count: files.length, files });
    },
  );

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Flash receiver running at ${device.url}`);
    console.log(`Saving files to ${recieveDir}`);
  });

  const bonjour = new Bonjour();
  bonjour.publish({
    name: `Flash ${device.name}`,
    type: SERVICE_TYPE,
    port: PORT,
    txt: {
      name: device.name,
      type: "desktop",
    },
  });
  const browser = bonjour.find({ type: SERVICE_TYPE });

  browser.on("up", (service) => {
    const addresses = service.addresses || [];
    const ipv4 = addresses.find(
      (address) =>
        /^\d{1,3}(\.\d{1,3}){3}$/.test(address) && !address.startsWith("127."),
    );

    if (!ipv4 || (ipv4 === device.ip && service.port === PORT)) return;

    const key = `${service.name}:${service.port}`;
    discoveredDevices.set(key, {
      name: service.txt?.name || service.name,
      url: `http://${ipv4}:${service.port}`,
    });
  });

  browser.on("down", (service) => {
    discoveredDevices.delete(`${service.name}:${service.port}`);
  });

  const stop = () => {
    browser.stop()
    bonjour.unpublishAll(() => {
      bonjour.destroy();
    });
    server.close();
  };

  return { server, device, recieveDir, stop };
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer, getDeviceInfo, PORT };
