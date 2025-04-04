const os = require("os");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const crypto = require("crypto-js");
const { v4: uuidv4 } = require("uuid");
const { app } = require("electron");

/**
 * 系统工具模块
 */
const systemUtils = {
  /**
   * 获取MAC地址
   * @returns {string} MAC地址
   */
  getMacAddress() {
    const networkInterfaces = os.networkInterfaces();
    let macAddress = "";

    Object.keys(networkInterfaces).forEach((interfaceName) => {
      const interfaces = networkInterfaces[interfaceName];
      for (let i = 0; i < interfaces.length; i++) {
        const interface = interfaces[i];
        if (!interface.internal && interface.mac !== "00:00:00:00:00:00") {
          macAddress = interface.mac;
          break;
        }
      }
    });

    return macAddress || "unknown";
  },

  /**
   * 获取IP地址
   * @returns {string} IP地址
   */
  getIpAddress() {
    const networkInterfaces = os.networkInterfaces();
    let ipAddress = "";

    Object.keys(networkInterfaces).forEach((interfaceName) => {
      const interfaces = networkInterfaces[interfaceName];
      for (let i = 0; i < interfaces.length; i++) {
        const interface = interfaces[i];
        if (!interface.internal && interface.family === "IPv4") {
          ipAddress = interface.address;
          break;
        }
      }
    });

    return ipAddress || "unknown";
  },

  /**
   * 获取系统信息
   * @returns {Object} 系统信息
   */
  getSystemInfo() {
    return {
      macAddress: this.getMacAddress(),
      ipAddress: this.getIpAddress(),
      hostName: os.hostname(),
      platform: os.platform(),
      osVersion: os.release(),
      arch: os.arch(),
      cpuInfo: os.cpus()[0].model,
      memoryTotal:
        Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 100) / 100 + " GB",
      memoryFree:
        Math.round((os.freemem() / (1024 * 1024 * 1024)) * 100) / 100 + " GB",
    };
  },

  /**
   * 获取当前CPU和内存使用情况
   * @returns {Object} CPU和内存使用状态
   */
  getResourceUsage() {
    return {
      cpuUsage: process.cpuUsage(),
      memoryUsage: process.memoryUsage(),
      systemMemory: {
        total: os.totalmem(),
        free: os.freemem(),
        percentUsed: Math.round((1 - os.freemem() / os.totalmem()) * 100),
      },
    };
  },

  /**
   * 检查FFmpeg是否安装
   * @returns {string|null} FFmpeg路径，未安装则返回null
   */
  checkFFmpeg() {
    let ffmpegPath = "";

    try {
      // 尝试运行ffmpeg命令
      const output = execSync("ffmpeg -version").toString();
      console.log("FFmpeg已安装:", output.split("\n")[0]);

      // 通过which/where命令找到路径
      try {
        if (process.platform === "win32") {
          ffmpegPath = execSync("where ffmpeg")
            .toString()
            .trim()
            .split("\n")[0];
        } else {
          ffmpegPath = execSync("which ffmpeg").toString().trim();
        }
        console.log("FFmpeg路径:", ffmpegPath);
      } catch (err) {
        console.warn("无法确定FFmpeg的精确路径，将使用默认命令");
        ffmpegPath = "ffmpeg";
      }

      return ffmpegPath;
    } catch (err) {
      console.error("FFmpeg未安装或无法访问:", err.message);
      return null;
    }
  },

  /**
   * 创建临时目录
   * @param {string} dirName 目录名
   * @returns {string} 临时目录路径
   */
  createTempDir(dirName = "exam-monitor-temp") {
    const tempDir = path.join(os.tmpdir(), dirName);

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
      console.log("创建临时目录:", tempDir);
    }

    return tempDir;
  },

  /**
   * 创建媒体根目录
   * @returns {string} 媒体根目录路径
   */
  createMediaRoot() {
    const mediaRoot = path.join(app.getPath("userData"), "media");

    if (!fs.existsSync(mediaRoot)) {
      try {
        fs.mkdirSync(mediaRoot, { recursive: true });
        console.log("创建媒体根目录:", mediaRoot);
      } catch (err) {
        console.error("创建媒体根目录失败:", err);
      }
    }

    return mediaRoot;
  },

  /**
   * 获取应用程序数据路径
   * @returns {string} 应用程序数据路径
   */
  getAppDataPath() {
    return app.getPath("userData");
  },

  /**
   * 生成唯一的流密钥
   * @returns {string} 流密钥
   */
  generateStreamKey() {
    const macAddress = this.getMacAddress();
    return crypto
      .MD5(macAddress + uuidv4())
      .toString()
      .substring(0, 16);
  },
};

module.exports = systemUtils;
