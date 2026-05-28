"use strict";

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const ffmpegPath = require("ffmpeg-static");

const MAX_INPUT = 100 * 1024 * 1024;

function tmpFile(ext) {
  return path.join(os.tmpdir(), crypto.randomBytes(8).toString("hex") + ext);
}

function unlinkSilent(p) {
  fs.unlink(p, () => {});
}

async function webmToMp4(webmBuf) {
  if (!webmBuf || webmBuf.length < 100) {
    throw new Error("Empty or invalid input");
  }
  if (webmBuf.length > MAX_INPUT) {
    throw new Error("Input too large");
  }

  const inFile = tmpFile(".webm");
  const outFile = tmpFile(".mp4");

  await fs.promises.writeFile(inFile, webmBuf);

  try {
    await new Promise((resolve, reject) => {
      execFile(
        ffmpegPath,
        [
          "-y",
          "-i", inFile,
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-crf", "23",
          "-movflags", "+faststart",
          "-an",
          outFile,
        ],
        { maxBuffer: MAX_INPUT },
        (err, _stdout, stderr) => {
          if (err) {
            err.stderr = (stderr || "").toString().slice(0, 300);
            return reject(err);
          }
          resolve();
        }
      );
    });

    const out = await fs.promises.readFile(outFile);
    return out;
  } finally {
    unlinkSilent(inFile);
    unlinkSilent(outFile);
  }
}

module.exports = { webmToMp4 };
