const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3000;
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(200); res.end(); return;
  }

  // Serve index.html
  if (req.method === "GET" && parsedUrl.pathname === "/") {
    const filePath = path.join(__dirname, "public", "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end("Not found"); return; }
      res.setHeader("Content-Type", "text/html");
      res.writeHead(200); res.end(data);
    });
    return;
  }

  // API endpoint
  if (req.method === "POST" && parsedUrl.pathname === "/api/generate") {
    if (!OPENAI_KEY) {
      res.setHeader("Content-Type", "application/json");
      res.writeHead(500);
      res.end(JSON.stringify({ error: "OPENAI_API_KEY not set on server" }));
      return;
    }

    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); return;
      }

      const payload = JSON.stringify({
        model: "gpt-image-1",
        prompt: parsed.prompt,
        n: 1,
        size: parsed.size || "1536x1024",
        quality: "high"
      });

      console.log("Calling OpenAI...");
      const apiReq = https.request({
        hostname: "api.openai.com",
        path: "/v1/images/generations",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + OPENAI_KEY,
          "Content-Length": Buffer.byteLength(payload)
        }
      }, (apiRes) => {
        let data = "";
        apiRes.on("data", chunk => data += chunk);
        apiRes.on("end", () => {
          console.log("OpenAI status:", apiRes.statusCode);
          res.setHeader("Content-Type", "application/json");
          res.writeHead(apiRes.statusCode);
          res.end(data);
        });
      });
      apiReq.on("error", (e) => {
        console.error("OpenAI error:", e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      });
      apiReq.write(payload);
      apiReq.end();
    });
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.timeout = 120000; // 2 minute timeout
server.listen(PORT, () => console.log("NightKit running on port " + PORT));
