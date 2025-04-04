const path = require("path");
const Store = require("electron-store");
const { app } = require("electron");

// 创建配置存储实例
const store = new Store({
  encryptionKey: "exam_monitor_key", // 加密密钥
  name: "config", // 配置文件名
});

// 获取默认配置
const defaultConfig = {
  serverIp: "",
  serverPort: "8080", // 默认端口
  serverPassword: "",
  machineNumber: "",
};

// 配置管理对象
const config = {
  // 获取服务器配置
  getServerConfig() {
    return {
      serverIp: store.get("serverIp", defaultConfig.serverIp),
      serverPort: store.get("serverPort", defaultConfig.serverPort),
      serverPassword: store.get("serverPassword", defaultConfig.serverPassword),
      machineNumber: store.get("machineNumber", defaultConfig.machineNumber),
    };
  },

  // 设置服务器配置
  setServerConfig(serverConfig) {
    store.set("serverIp", serverConfig.serverIp || defaultConfig.serverIp);
    store.set(
      "serverPort",
      serverConfig.serverPort || defaultConfig.serverPort
    );
    store.set(
      "serverPassword",
      serverConfig.serverPassword || defaultConfig.serverPassword
    );
    store.set(
      "machineNumber",
      serverConfig.machineNumber || defaultConfig.machineNumber
    );
    return this.getServerConfig();
  },

  // 获取当前登录的学生信息
  getStudentInfo() {
    return store.get("currentStudent", { studentId: "", studentName: "" });
  },

  // 设置学生信息
  setStudentInfo(studentInfo) {
    store.set("currentStudent", studentInfo);
    return this.getStudentInfo();
  },

  // 获取媒体配置
  getMediaConfig() {
    return {
      rtmpPort: store.get("rtmpPort", 1935),
      httpPort: store.get("httpPort", 8000),
      mediaRoot: store.get(
        "mediaRoot",
        path.join(app.getPath("userData"), "media")
      ),
    };
  },

  // 设置媒体配置
  setMediaConfig(mediaConfig) {
    if (mediaConfig.rtmpPort) store.set("rtmpPort", mediaConfig.rtmpPort);
    if (mediaConfig.httpPort) store.set("httpPort", mediaConfig.httpPort);
    if (mediaConfig.mediaRoot) store.set("mediaRoot", mediaConfig.mediaRoot);
    return this.getMediaConfig();
  },

  // 获取完整的服务器URL
  getServerUrl() {
    const { serverIp, serverPort } = this.getServerConfig();
    if (!serverIp) return "";
    return `http://${serverIp}:${serverPort}`;
  },

  // 获取API的URL
  getApiUrl(endpoint) {
    const baseUrl = this.getServerUrl();
    if (!baseUrl) return "";
    return `${baseUrl}/api/${endpoint}`;
  },

  // 清除所有配置
  clearAll() {
    store.clear();
  },
};

module.exports = config;
