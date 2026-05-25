const https = require("https");
const { execFile } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const os = require("os");
const crypto = require("crypto");
const http  = require("http");
const fs    = require("fs");
const path  = require("path");
const url   = require("url");

const PORT         = process.env.PORT || 3000;
const IDEOGRAM_KEY = process.env.IDEOGRAM_API_KEY || "";

var jobs = {};

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
    p += "1. Small decorative text above main title: \"" + prefix + "\"\n";
  } else {
    p += "1. Small decorative text above main title: REMOVE IT COMPLETELY\n";
  }

  if (name) {
    p += "2. Main event title (largest text, ALL CAPS): \"" + name + "\"\n";
  }

  if (genre) {
    p += "3. Secondary banner text (ALL CAPS): \"" + genre + "\"\n";
  }

  if (day || date) {
    p += "4. Date section (ALL CAPS): \"" + [day, date].filter(Boolean).join(" ") + "\"\n";
  }

  if (djList.length) {
    p += "5. DJ/artist names (ALL CAPS, one per line): " + djList.map(function(d){return "\""+d+"\"";}).join(", ") + "\n";
  } else {
    p += "5. DJ/artist names section: REMOVE ALL NAMES\n";
  }

  if (time || entry) {
    var details = [];
    if (time) details.push("EINLASS: " + time + " UHR");
    if (entry) details.push("EINTRITT: " + entry);
    p += "6. Event details: \"" + details.join(" | ") + "\"\n";
  }

  if (contact) {
    p += "7. Website at bottom (ALL CAPS): \"" + contact + "\"\n";
  }

  p += "\nDo not add any text not listed above. Remove any original text that has no replacement in this list. ";
  p += "The capitalization shown above is final — render every letter exactly as written.";
  return p;
}

function runIdeogramJob(jobId, ev) {
  var prompt = buildPrompt(ev);
  console.log("Job", jobId, "prompt:\n" + prompt);

  var imgBuffer;
  try {
    imgBuffer = fs.readFileSync(path.join(__dirname, "templates", "default.png"));
  } catch(e) {
    jobs[jobId] = { status: "error", error: "Template not found" };
    return;
  }

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
      "Content-Disposition: form-data; name=\"images\"; filename=\"template.png\""+CRLF+
      "Content-Type: image/png"+CRLF+CRLF, "utf8"
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

  console.log("Job", jobId, "calling Ideogram, size:", reqBody.length);

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
      console.log("Job", jobId, "Ideogram status:", apiRes.statusCode, data.substring(0,200));
      try {
        var j = JSON.parse(data);
        if (apiRes.statusCode !== 200) {
          jobs[jobId] = { status: "error", error: j.detail || j.message || data.substring(0,300) };
          return;
        }
        var imgUrl = j.data && j.data[0] && j.data[0].url;
        if (!imgUrl) {
          jobs[jobId] = { status: "error", error: "No image URL in response" };
          return;
        }
        jobs[jobId] = { status: "done", url: imgUrl };
      } catch(e) {
        jobs[jobId] = { status: "error", error: "Parse error: " + data.substring(0,200) };
      }
    });
  });

  apiReq.on("error", function(e) {
    jobs[jobId] = { status: "error", error: e.message };
  });

  apiReq.write(reqBody);
  apiReq.end();
}

var server = http.createServer(function(req, res) {
  var p = url.parse(req.url).pathname;
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  if (req.method === "GET" && /^\/[a-zA-Z0-9._-]*$/.test(p)) {
    var fileName = p === "/" ? "index.html" : p.slice(1);
    var filePath = path.join(__dirname, "public", fileName);
    var ext = path.extname(fileName);
    var mime = {".html":"text/html",".js":"application/javascript",".css":"text/css",".png":"image/png",".jpg":"image/jpeg"}[ext] || "application/octet-stream";
    fs.readFile(filePath, function(err, data) {
      if (err) { res.writeHead(404); res.end("Not found"); return; }
      res.setHeader("Content-Type", mime);
      res.writeHead(200); res.end(data);
    });
    return;
  }

  // Start a generation job — returns jobId immediately
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
      var jobId = crypto.randomBytes(8).toString("hex");
      jobs[jobId] = { status: "pending" };
      res.setHeader("Content-Type","application/json");
      res.writeHead(202);
      res.end(JSON.stringify({ jobId: jobId }));
      runIdeogramJob(jobId, ev);
    });
    return;
  }

  // Proxy external images to avoid canvas CORS tainting
  if (req.method === "GET" && p === "/api/proxy") {
    var imageUrl = url.parse(req.url, true).query.url;
    if (!imageUrl) { res.writeHead(400); res.end("missing url"); return; }
    https.get(imageUrl, function(imgRes) {
      res.setHeader("Content-Type", imgRes.headers["content-type"] || "image/jpeg");
      res.writeHead(200);
      imgRes.pipe(res);
    }).on("error", function(e) { res.writeHead(500); res.end(e.message); });
    return;
  }

  // Poll job status
  if (req.method === "GET" && /^\/api\/status\/[a-f0-9]+$/.test(p)) {
    var jobId = p.split("/").pop();
    var job = jobs[jobId];
    if (!job) { res.writeHead(404); res.end(JSON.stringify({error:"Job not found"})); return; }
    res.setHeader("Content-Type","application/json");
    res.writeHead(200);
    res.end(JSON.stringify(job));
    if (job.status !== "pending") delete jobs[jobId];
    return;
  }

  if (req.method === "POST" && p === "/api/convert") {
    var chunks = [];
    req.on("data", function(c){ chunks.push(c); });
    req.on("end", function(){
      var webmBuf = Buffer.concat(chunks);
      console.log("convert request, size:", webmBuf.length);
      if(webmBuf.length < 100){
        res.writeHead(400); res.end("Empty or invalid input"); return;
      }
      var tmpId = crypto.randomBytes(8).toString("hex");
      var inFile = os.tmpdir() + "/" + tmpId + ".webm";
      var outFile = os.tmpdir() + "/" + tmpId + ".mp4";
      fs.writeFile(inFile, webmBuf, function(err){
        if(err){ console.error("write error:", err); res.writeHead(500); res.end("write failed"); return; }
        execFile(ffmpegPath,["-y","-i",inFile,"-c:v","libx264","-preset","ultrafast","-crf","23","-movflags","+faststart","-an",outFile],
          {maxBuffer: 100*1024*1024},
          function(err2, stdout, stderr){
            fs.unlink(inFile, function(){});
            if(err2){
              fs.unlink(outFile, function(){});
              console.error("ffmpeg error:", err2.message, stderr.slice(0,500));
              res.writeHead(500); res.end("ffmpeg failed: " + err2.message + " | " + stderr.slice(0,300)); return;
            }
            fs.readFile(outFile, function(err3, mp4Buf){
              fs.unlink(outFile, function(){});
              if(err3){ res.writeHead(500); res.end("read failed"); return; }
              console.log("MP4 size:", mp4Buf.length);
              res.setHeader("Content-Type","video/mp4");
              res.setHeader("Content-Length", mp4Buf.length);
              res.writeHead(200); res.end(mp4Buf);
            });
          }
        );
      });
    });
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.timeout = 120000;
server.listen(PORT, function(){ console.log("NightKit on port "+PORT); });
