//
//  Created by Mingliang Chen on 17/8/23.
//  illuspas[a]gmail.com
//  Copyright (c) 2018 Nodemedia. All rights reserved.
//
const Crypto = require("crypto");
const { spawn } = require("child_process");
const context = require("./node_core_ctx");

function generateNewSessionID() {
  let sessionID = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWKYZ0123456789";
  const numPossible = possible.length;
  do {
    for (let i = 0; i < 8; i++) {
      sessionID += possible.charAt((Math.random() * numPossible) | 0);
    }
  } while (context.sessions.has(sessionID));
  return sessionID;
}

function genRandomName() {
  let name = "";
  const possible = "abcdefghijklmnopqrstuvwxyz0123456789";
  const numPossible = possible.length;
  for (let i = 0; i < 4; i++) {
    name += possible.charAt((Math.random() * numPossible) | 0);
  }

  return name;
}

function verifyAuth(signStr, streamId, secretKey) {
  if (signStr === undefined) {
    return false;
  }
  let now = (Date.now() / 1000) | 0;
  let exp = parseInt(signStr.split("-")[0]);
  let shv = signStr.split("-")[1];
  let str = streamId + "-" + exp + "-" + secretKey;
  if (exp < now) {
    return false;
  }
  let md5 = Crypto.createHash("md5");
  let ohv = md5.update(str).digest("hex");
  return shv === ohv;
}

/**
 * 获取FFmpeg版本
 * @returns {string} FFmpeg版本信息
 */
function getFFmpegVersion(ffmpegPath) {
  try {
    const ffmpeg = spawn(ffmpegPath || "ffmpeg", ["-version"]);
    let version = "";
    ffmpeg.stdout.on("data", (data) => {
      version += data.toString();
    });
    return version.split(" ")[2] || "unknown";
  } catch (error) {
    return "unknown";
  }
}

/**
 * 获取FFmpeg下载地址
 * @returns {string} FFmpeg下载地址
 */
function getFFmpegUrl() {
  switch (process.platform) {
    case "win32":
      return "https://ffmpeg.zeranoe.com/builds/";
    case "darwin":
      return "https://evermeet.cx/ffmpeg/";
    case "linux":
      return "https://johnvansickle.com/ffmpeg/";
    default:
      return "https://ffmpeg.org/download.html";
  }
}

module.exports = {
  generateNewSessionID,
  verifyAuth,
  genRandomName,
  getFFmpegVersion,
  getFFmpegUrl,
};
