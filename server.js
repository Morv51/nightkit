const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3000;
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

// Cache for generated background
let cachedBgB64 = null;
let cachedBgBuffer = null;

const BG_PROMPT = `Professional nightclub event flyer BACKGROUND only. No people, no text, no letters.

Dark tropical nightclub atmosphere:
- Pure black background  
- Large dramatic monstera leaves and tropical palm fronds filling the entire frame
- Dark deep emerald green leaves, some catching warm light on edges
- Warm bronze and copper bokeh light orbs scattered in background
- Subtle warm amber lighting
- Cinematic moody high-end club atmosphere
- Professional photography quality photorealistic

NO people, NO text, NO words, NO letters anywhere.`;

function buildEditPrompt(data) {
  const name    = data.name    || "EVENT";
  const venue   = data.venue   || "";
  const day     = data.day     || "SAMSTAG";
  const date    = data.date    || "";
  const time    = data.time    || "";
  const entry   = data.entry   || "";
  const dj      = data.dj      || "";
  const genre   = data.genre   || "";
  const contact = data.contact || "";
  const extras  = data.extras  || "";

  const details = [
    time    ? `Einlass: ${time} Uhr` : "",
    entry   ? `Eintritt: ${entry}` : "",
    extras,
    contact
  ].filter(Boolean).join(" | ");

  return `This is a dark tropical nightclub background. Add professional event flyer text overlay exactly as follows:

TOP LEFT:
- "${name.toUpperCase()}" in bold white uppercase font, ~32pt, strong drop shadow
- "${genre.toUpperCase()}" below in smaller white text ~14pt, words separated by dots ·

TOP RIGHT:
- "${day.toUpperCase()}" small white uppercase label
- White bordered rectangle box containing "${date}" in large bold white numbers

CENTER (large hero text overlapping leaves):
- "${name}" in large 3D metallic bronze/gold script, spanning ~60% of image width, with depth and glow

BOTTOM RIGHT:
- "${venue}" bold white ~22pt
- "${dj ? "DJ: " + dj : ""}" white ~14pt

BOTTOM CENTER:
- "${details}" white ~12pt centered

Keep the tropical leaves and dark background atmosphere completely intact.`;
}

function callOpenAI(path, method, payload, isMultipart, boundary, cb) {
  const options = {
    hostname: "api.openai.com",
    path,
    method,
    headers: isMultipart
      ? { "Authorization": "Bearer " + OPENAI_KEY, "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": payload.length }
      : { "Authorization": "Bearer " + OPENAI_KEY, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
  };
  const req = https.request(options, res => {
    let data = "";
    res.on("data", c => data += c);
    res.on("end", () => cb(null, res.statusCode, data));
  });
  req.on("error", e => cb(e));
  req.write(payload);
  req.end();
}

function generateBackground(cb) {
  if (cachedBgBuffer) { console.log("Using cached background"); return cb(null, cachedBgBuffer); }
  console.log("Generating background image...");
  const payload = JSON.stringify({
    model: "gpt-image-1",
    prompt: BG_PROMPT,
    n: 1,
    size: "1536x1024",
    quality: "high"
  });
  callOpenAI("/v1/images/generations", "POST", payload, false, null, (err, status, data) => {
    if (err) return cb(err);
    console.log("Background gen status:", status);
    try {
      const json = JSON.parse(data);
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) return cb(new Error("No image in response: " + data.substring(0,200)));
      cachedBgB64 = b64;
      cachedBgBuffer = Buffer.from(b64, "base64");
      cb(null, cachedBgBuffer);
    } catch(e) { cb(new Error("Parse error: " + data.substring(0,200))); }
  });
}

function editWithText(imgBuffer, prompt, cb) {
  const boundary = "----NightKitBoundary" + Date.now().toString(36);
  const CRLF = "\r\n";
  const parts = [
    `--${boundary}${CRLF}Content-Disposition: form-data; name="model"${CRLF}${CRLF}gpt-image-1`,
    `--${boundary}${CRLF}Content-Disposition: form-data; name="prompt"${CRLF}${CRLF}${prompt}`,
    `--${boundary}${CRLF}Content-Disposition: form-data; name="n"${CRLF}${CRLF}1`,
    `--${boundary}${CRLF}Content-Disposition: form-data; name="size"${CRLF}${CRLF}1536x1024`,
    `--${boundary}${CRLF}Content-Disposition: form-data; name="quality"${CRLF}${CRLF}high`
  ].join(CRLF);

  const imgHeader = `--${boundary}${CRLF}Content-Disposition: form-data; name="image[]"; filename="bg.png"${CRLF}Content-Type: image/png${CRLF}${CRLF}`;
  const footer = `${CRLF}--${boundary}--${CRLF}`;
  const body = Buffer.concat([Buffer.from(parts+CRLF,"utf8"), Buffer.from(imgHeader,"utf8"), imgBuffer, Buffer.from(footer,"utf8")]);

  callOpenAI("/v1/images/edits", "POST", body, true, boundary, (err, status, data) => {
    if (err) return cb(err);
    console.log("Edit status:", status, data.substring(0,150));
    if (status !== 200) {
      // Fallback: use generation with detailed prompt
      console.log("Edit failed, falling back to generation...");
      const genPayload = JSON.stringify({ model:"gpt-image-1", prompt: BG_PROMPT + "\n\n" + prompt, n:1, size:"1536x1024", quality:"high" });
      callOpenAI("/v1/images/generations","POST",genPayload,false,null,(e2,s2,d2)=>{
        if(e2)return cb(e2);
        cb(null, s2, d2);
      });
      return;
    }
    cb(null, status, data);
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  res.setHeader("Access-Control-Allow-Methods","POST,GET,OPTIONS");
  if(req.method==="OPTIONS"){res.writeHead(200);res.end();return;}

  if(req.method==="GET"&&parsedUrl.pathname==="/"){
    fs.readFile(path.join(__dirname,"public","index.html"),(err,data)=>{
      if(err){res.writeHead(404);res.end("Not found");return;}
      res.setHeader("Content-Type","text/html");res.writeHead(200);res.end(data);
    });
    return;
  }

  // Pre-warm background
  if(req.method==="GET"&&parsedUrl.pathname==="/api/warmup"){
    generateBackground((err)=>{
      res.setHeader("Content-Type","application/json");
      res.writeHead(200);
      res.end(JSON.stringify({status: err?"error":"ready", error:err?.message}));
    });
    return;
  }

  if(req.method==="POST"&&parsedUrl.pathname==="/api/generate"){
    if(!OPENAI_KEY){
      res.setHeader("Content-Type","application/json");res.writeHead(500);
      res.end(JSON.stringify({error:"OPENAI_API_KEY not configured"}));return;
    }
    let body="";
    req.on("data",c=>body+=c);
    req.on("end",()=>{
      let parsed;
      try{parsed=JSON.parse(body);}catch(e){res.writeHead(400);res.end(JSON.stringify({error:"Invalid JSON"}));return;}

      const prompt = buildEditPrompt(parsed);

      // Step 1: get/generate background
      generateBackground((err, bgBuffer) => {
        if(err){
          console.error("Background error:", err.message);
          res.writeHead(500);res.end(JSON.stringify({error:"Background generation failed: "+err.message}));return;
        }
        // Step 2: edit with text
        editWithText(bgBuffer, prompt, (err2, status, data) => {
          if(err2){res.writeHead(500);res.end(JSON.stringify({error:err2.message}));return;}
          res.setHeader("Content-Type","application/json");res.writeHead(status);res.end(data);
        });
      });
    });
    return;
  }
  res.writeHead(404);res.end("Not found");
});

server.timeout = 300000;
server.listen(PORT,()=>console.log("NightKit on port "+PORT));
