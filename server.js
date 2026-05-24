const https = require("https");
const http  = require("http");
const fs    = require("fs");
const path  = require("path");
const url   = require("url");

const PORT         = process.env.PORT || 3000;
const IDEOGRAM_KEY = process.env.IDEOGRAM_API_KEY || "";
const IMG_B64      = "TEMPLATE_IMAGE_B64_HERE";

function buildPrompt(ev) {
  var name    = (ev.name    || "").trim().toUpperCase();
  var prefix  = (ev.prefix  || "").trim().toUpperCase();
  var genre   = (ev.genre   || "").trim().toUpperCase();
  var day     = (ev.day     || "").trim().toUpperCase();
  var date    = (ev.date    || "").trim();
  var dj      = (ev.dj      || "").trim();
  var contact = (ev.contact || "").trim().toUpperCase();
  var time    = (ev.time    || "").trim();
  var entry   = (ev.entry   || "").trim();
  var djList  = dj.length ? dj.split(",").map(function(d){return d.trim().toUpperCase();}).filter(Boolean) : [];

  var p = "Edit this nightclub event flyer. ";
  p += "Keep ALL visual elements completely identical — people, background, colors, textures, effects, decorations, layout, composition. ";
  p += "Only replace the text content. CRITICAL: Every text element must use EXACTLY the same font, capitalization style, color and position as the original template — do not change the typography or letter case, only swap the words.\n\n";
  p += "Replace each text element with these exact strings (use ALL CAPS exactly as written here):\n";

  if (prefix) {
    p += "1. Small decorative text above main title: "" + prefix + ""\n";
  } else {
    p += "1. Small decorative text above main title: REMOVE IT COMPLETELY\n";
  }

  if (name) {
    p += "2. Main event title (largest text, ALL CAPS): "" + name + ""\n";
  }

  if (genre) {
    p += "3. Secondary banner text (ALL CAPS): "" + genre + ""\n";
  }

  if (day || date) {
    p += "4. Date section (ALL CAPS): "" + [day, date].filter(Boolean).join(" ") + ""\n";
  }

  if (djList.length) {
    p += "5. DJ/artist names (ALL CAPS, one per line): " + djList.map(function(d){return """+d+""";}).join(", ") + "\n";
  } else {
    p += "5. DJ/artist names section: REMOVE ALL NAMES\n";
  }

  if (time || entry) {
    var details = [];
    if (time) details.push("EINLASS: " + time + " UHR");
    if (entry) details.push("EINTRITT: " + entry);
    p += "6. Event details: "" + details.join(" | ") + ""\n";
  }

  if (contact) {
    p += "7. Website at bottom (ALL CAPS): "" + contact + ""\n";
  }

  p += "\nDo not add any text not listed above. Remove any original text that has no replacement in this list. ";
  p += "The capitalization shown above is final — render every letter exactly as written.";
  return p;
}

var server = http.createServer(function(req, res) {
  var p = url.parse(req.url).pathname;
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  if (req.method === "GET" && p === "/") {
    fs.readFile(path.join(__dirname,"public","index.html"), function(err, data) {
      if (err) { res.writeHead(404); res.end("Not found"); return; }
      res.setHeader("Content-Type","text/html");
      // Required for SharedArrayBuffer (ffmpeg.wasm needs crossOriginIsolated)
      res.setHeader("Cross-Origin-Opener-Policy","same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy","require-corp");
      res.writeHead(200); res.end(data);
    });
    return;
  }

  if (req.method === "POST" && p === "/api/generate") {
    if (!IDEOGRAM_KEY) {
      res.writeHead(500);
      res.end(JSON.stringify({error:"IDEOGRAM_API_KEY not configured"}));
      return;
    }
    var body = "";
    req.on("data", function(c){ body += c; });
    req.on("end", function() {
      var ev;
      try { ev = JSON.parse(body); } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({error:"Invalid JSON"})); return;
      }

      var prompt = buildPrompt(ev);
      console.log("Prompt:\n" + prompt);

      var imgBuffer = Buffer.from(IMG_B64, "base64");
      var boundary = "----NKB" + Date.now().toString(36);
      var CRLF = "\r\n";

      function field(name, value) {
        return Buffer.from(
          "--"+boundary+CRLF+
          "Content-Disposition: form-data; name=\""+name+"\""+CRLF+CRLF+
          value+CRLF, "utf8"
        );
      }

      var imgPart = Buffer.concat([
        Buffer.from(
          "--"+boundary+CRLF+
          "Content-Disposition: form-data; name=\"images\"; filename=\"template.jpg\""+CRLF+
          "Content-Type: image/jpeg"+CRLF+CRLF, "utf8"
        ),
        imgBuffer,
        Buffer.from(CRLF, "utf8")
      ]);

      var reqBody = Buffer.concat([
        field("prompt", prompt),
        field("aspect_ratio", "9x16"),
        field("magic_prompt", "OFF"),
        imgPart,
        Buffer.from("--"+boundary+"--"+CRLF, "utf8")
      ]);

      console.log("Calling Ideogram Edit API, size:", reqBody.length);

      var apiReq = https.request({
        hostname: "api.ideogram.ai",
        path: "/v1/edit",
        method: "POST",
        headers: {
          "Api-Key": IDEOGRAM_KEY,
          "Content-Type": "multipart/form-data; boundary="+boundary,
          "Content-Length": reqBody.length
        }
      }, function(apiRes) {
        var data = "";
        apiRes.on("data", function(c){ data += c; });
        apiRes.on("end", function() {
          console.log("Ideogram Edit status:", apiRes.statusCode, data.substring(0,400));
          try {
            var j = JSON.parse(data);
            if (apiRes.statusCode !== 200) {
              return res.writeHead(apiRes.statusCode),
                     res.end(JSON.stringify({error: j.detail || j.message || data.substring(0,300)}));
            }
            var imgUrl = j.data && j.data[0] && j.data[0].url;
            if (!imgUrl) return res.writeHead(500), res.end(JSON.stringify({error:"No image URL: "+data.substring(0,200)}));
            res.setHeader("Content-Type","application/json");
            res.writeHead(200);
            res.end(JSON.stringify({url: imgUrl}));
          } catch(e) {
            res.writeHead(500); res.end(JSON.stringify({error:"Parse error: "+data.substring(0,200)}));
          }
        });
      });
      apiReq.on("error", function(e){ res.writeHead(500); res.end(JSON.stringify({error:e.message})); });
      apiReq.write(reqBody);
      apiReq.end();
    });
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.timeout = 120000;
server.listen(PORT, function(){ console.log("NightKit Ideogram Edit on port "+PORT); });
