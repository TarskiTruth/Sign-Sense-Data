// Local Sign Sense server: serves the app and saves each approved capture immediately.
const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const root = __dirname;
const sessionsRoot = path.join(root, "sessions");
const port = Number(process.env.SIGN_SENSE_PORT || 8001);
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".webm": "video/webm" };
const safePart = (value) => /^[a-z0-9_-]+$/i.test(value) ? value : null;
const send = (res, status, body, type = "application/json; charset=utf-8") => { res.writeHead(status, { "Content-Type": type }); res.end(body); };
const body = (req) => new Promise((resolve, reject) => { const chunks = []; req.on("data", (chunk) => chunks.push(chunk)); req.on("end", () => resolve(Buffer.concat(chunks))); req.on("error", reject); });

async function savedCaptures(session) {
  const saved = [];
  let signs;
  try { signs = await fsp.readdir(session, { withFileTypes: true }); } catch { return saved; }
  for (const sign of signs.filter((entry) => entry.isDirectory())) {
    const signRoot = path.join(session, sign.name);
    const orientations = await fsp.readdir(signRoot, { withFileTypes: true });
    for (const orientation of orientations.filter((entry) => entry.isDirectory())) {
      const match = /^tilt_(forward|neutral|back)_(toward|neutral|away)_([12])$/.exec(orientation.name);
      if (!match) continue;
      const folder = path.join(signRoot, orientation.name);
      const complete = ["landmarks_trimmed.json", "landmarks_untrimmed.json"].every((name) => fs.existsSync(path.join(folder, name)));
      if (complete) saved.push({ label: sign.name, orientation: `lid_${match[1]}_hand_${match[2]}_take_${match[3]}` });
    }
  }
  return saved;
}

function sendFile(req, res, target) {
  const size = fs.statSync(target).size;
  const type = mime[path.extname(target).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(target).pipe(res);
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.writeHead(416, { "Content-Range": `bytes */${size}` });
    return res.end();
  }
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start === null) {
    const suffixLength = Math.min(end || 0, size);
    start = size - suffixLength;
    end = size - 1;
  } else {
    end = end === null ? size - 1 : Math.min(end, size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
    res.writeHead(416, { "Content-Range": `bytes */${size}` });
    return res.end();
  }
  res.writeHead(206, {
    "Content-Type": type,
    "Content-Length": end - start + 1,
    "Content-Range": `bytes ${start}-${end}/${size}`,
    "Accept-Ranges": "bytes",
  });
  if (req.method === "HEAD") return res.end();
  return fs.createReadStream(target, { start, end }).pipe(res);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  try {
    if (url.pathname === "/api/references" && req.method === "GET") {
      const referenceRoot = path.join(root, "reference");
      const files = (await fsp.readdir(referenceRoot, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".mp4")
        .map((entry) => ({ label: path.basename(entry.name, path.extname(entry.name)), filename: entry.name, url: `/reference/${encodeURIComponent(entry.name)}` }))
        .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { sensitivity: "base" }));
      return send(res, 200, JSON.stringify(files));
    }
    if (parts[0] === "api" && parts[1] === "sessions" && safePart(parts[2])) {
      const session = path.join(sessionsRoot, parts[2]);
      if (parts[3] === "progress" && req.method === "GET") {
        return send(res, 200, JSON.stringify({ saved: await savedCaptures(session) }));
      }
      if (parts[3] === "state" && req.method === "GET") {
        try { return send(res, 200, await fsp.readFile(path.join(session, "session_state.json"))); } catch { return send(res, 200, JSON.stringify({ taskIndex: 0, saved: [] })); }
      }
      if (parts[3] === "state" && req.method === "PUT") {
        await fsp.mkdir(session, { recursive: true }); await fsp.writeFile(path.join(session, "session_state.json"), await body(req)); return send(res, 204, "");
      }
      if (parts[3] === "file" && req.method === "PUT" && parts[4]) {
        const relative = parts.slice(4).join("/");
        const target = path.resolve(session, relative);
        if (!target.startsWith(session + path.sep)) return send(res, 400, JSON.stringify({ error: "Invalid path" }));
        await fsp.mkdir(path.dirname(target), { recursive: true }); await fsp.writeFile(target, await body(req)); return send(res, 204, "");
      }
      if (parts[3] === "file" && req.method === "GET" && parts[4]) {
        const relative = parts.slice(4).join("/");
        const target = path.resolve(session, relative);
        if (!target.startsWith(session + path.sep) || !fs.existsSync(target)) return send(res, 404, "Not found", "text/plain");
        return send(res, 200, await fsp.readFile(target), mime[path.extname(target)] || "application/octet-stream");
      }
    }
    const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const target = path.resolve(root, requested);
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return send(res, 404, "Not found", "text/plain");
    if (req.method === "GET" || req.method === "HEAD") return sendFile(req, res, target);
    return send(res, 405, "Method not allowed", "text/plain");
  } catch (error) { console.error(error); return send(res, 500, JSON.stringify({ error: "Could not save session data." })); }
}).listen(port, () => console.log(`Sign Sense running at http://localhost:${port}`));
