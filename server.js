const https = require("https");
const http  = require("http");
const fs    = require("fs");
const path  = require("path");
const url   = require("url");

const PORT         = process.env.PORT || 3000;
const IDEOGRAM_KEY = process.env.IDEOGRAM_API_KEY || "";

// Template image is served from index.html directly via tplSrc variable
// We extract it here for the API call
function getTemplateB64() {
  try {
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    const m = html.match(/var tplSrc\s*=\s*"data:image\/jpeg;base64,([^"]+)"/);
    if (m) return m[1];
  } catch(e) {}
  return null;
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(prefix, name, genre, day, date, dj, contact, time, entry) {
  var p = "";
  p += "You are editing a nightclub event flyer. ";
  p += "Keep the existing visual style, background, colors, and layout exactly as they are. ";
  p += "Replace each text element with these exact strings (use ALL CAPS exactly as written):\n\n";

  if (prefix) {
    p += "1. Small decorative text above main title: \"" + prefix + "\"\n";
  } else {
    p += "1. Small decorative text above main title: REMOVE IT COMPLETELY\n";
  }

  p += "2. Main event title (largest text): \"" + name.toUpperCase() + "\"\n";

  if (genre) {
    p += "3. Edition/genre banner below title: \"" + genre.toUpperCase() + "\"\n";
  } else {
    p += "3. Edition/genre banner below title: REMOVE IT COMPLETELY\n";
  }

  p += "4. Day of week: \"" + day.toUpperCase() + "\"\n";
  p += "5. Date: \"" + date + "\"\n";

  if (dj) {
    var djList = dj.split(",").map(function(d) { return d.trim().toUpperCase(); }).join(" & ");
    p += "6. DJ/Artist names: \"" + djList + "\"\n";
  } else {
    p += "6. DJ/Artist names: REMOVE COMPLETELY\n";
  }

  if (contact) {
    p += "7. Website/contact: \"" + contact + "\"\n";
  } else {
    p += "7. Website/contact: REMOVE COMPLETELY\n";
  }

  p += "8. Time: \"" + time + " UHR\"\n";
  p += "9. Entry/price: \"" + entry + "\"\n";
  p += "\nIMPORTANT: Do NOT change anything else. ";
  p += "Keep all decorative elements, flames, patterns, characters, and background exactly the same. ";
  p += "Only update the text elements listed above.";

  return p;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise(function(resolve, reject) {
    var data = "";
    req.on("data", function(chunk) { data += chunk; });
    req.on("end",  function() { resolve(data); });
    req.on("error", reject);
  });
}

function sendJSON(res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

// ── Route: /api/generate ─────────────────────────────────────────────────────

async function handleGenerate(req, res) {
  if (!IDEOGRAM_KEY) {
    return sendJSON(res, 500, { error: "IDEOGRAM_API_KEY not configured" });
  }

  var raw;
  try {
    raw = await readBody(req);
  } catch(e) {
    return sendJSON(res, 400, { error: "Could not read request body" });
  }

  var fields;
  try {
    fields = JSON.parse(raw);
  } catch(e) {
    return sendJSON(res, 400, { error: "Invalid JSON" });
  }

  var prefix  = fields.prefix  || "";
  var name    = fields.name    || "";
  var genre   = fields.genre   || "";
  var day     = fields.day     || "";
  var date    = fields.date    || "";
  var dj      = fields.dj      || "";
  var contact = fields.contact || "";
  var time    = fields.time    || "";
  var entry   = fields.entry   || "";

  if (!name.trim()) {
    return sendJSON(res, 400, { error: "Event name is required" });
  }

  var prompt = buildPrompt(prefix, name, genre, day, date, dj, contact, time, entry);
  var imgB64 = getTemplateB64();

  if (!imgB64) {
    return sendJSON(res, 500, { error: "Template image not found in index.html" });
  }

  // Ideogram v3 Edit API
  var boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
  var CRLF = "\r\n";

  var promptPart = "";
  promptPart += "--" + boundary + CRLF;
  promptPart += "Content-Disposition: form-data; name=\"prompt\"" + CRLF + CRLF;
  promptPart += prompt + CRLF;

  promptPart += "--" + boundary + CRLF;
  promptPart += "Content-Disposition: form-data; name=\"model\"" + CRLF + CRLF;
  promptPart += "V_3" + CRLF;

  promptPart += "--" + boundary + CRLF;
  promptPart += "Content-Disposition: form-data; name=\"magic_prompt_option\"" + CRLF + CRLF;
  promptPart += "OFF" + CRLF;

  var imgBuffer = Buffer.from(imgB64, "base64");

  var imgPart = "";
  imgPart += "--" + boundary + CRLF;
  imgPart += "Content-Disposition: form-data; name=\"image_file\"; filename=\"template.jpg\"" + CRLF;
  imgPart += "Content-Type: image/jpeg" + CRLF + CRLF;

  var closing = CRLF + "--" + boundary + "--" + CRLF;

  var textBefore = Buffer.from(promptPart, "utf8");
  var textImgHeader = Buffer.from(imgPart, "utf8");
  var textAfter = Buffer.from(closing, "utf8");
  var body = Buffer.concat([textBefore, textImgHeader, imgBuffer, textAfter]);

  var options = {
    hostname: "api.ideogram.ai",
    path: "/edit",
    method: "POST",
    headers: {
      "Api-Key": IDEOGRAM_KEY,
      "Content-Type": "multipart/form-data; boundary=" + boundary,
      "Content-Length": body.length
    }
  };

  var response = await new Promise(function(resolve, reject) {
    var reqOut = https.request(options, function(resOut) {
      var data = [];
      resOut.on("data", function(chunk) { data.push(chunk); });
      resOut.on("end",  function() {
        resolve({ status: resOut.statusCode, body: Buffer.concat(data).toString() });
      });
    });
    reqOut.on("error", reject);
    reqOut.write(body);
    reqOut.end();
  });

  if (response.status !== 200) {
    return sendJSON(res, 502, { error: "Ideogram API error " + response.status, detail: response.body });
  }

  var parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch(e) {
    return sendJSON(res, 502, { error: "Invalid response from Ideogram API" });
  }

  var imageUrl = parsed && parsed.data && parsed.data[0] && parsed.data[0].url;
  if (!imageUrl) {
    return sendJSON(res, 502, { error: "No image URL in response", detail: response.body });
  }

  return sendJSON(res, 200, { url: imageUrl });
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

var server = http.createServer(async function(req, res) {
  var parsed = url.parse(req.url);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === "POST" && parsed.pathname === "/api/generate") {
    return handleGenerate(req, res);
  }

  // Static files
  var filePath = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
  filePath = path.join(__dirname, filePath);

  var ext = path.extname(filePath).toLowerCase();
  var mimeTypes = {
    ".html": "text/html",
    ".css":  "text/css",
    ".js":   "application/javascript",
    ".json": "application/json",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg":  "image/svg+xml",
    ".ico":  "image/x-icon"
  };

  var contentType = mimeTypes[ext] || "application/octet-stream";

  fs.readFile(filePath, function(err, data) {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(PORT, function() {
  console.log("NightKit running on port " + PORT);
});
