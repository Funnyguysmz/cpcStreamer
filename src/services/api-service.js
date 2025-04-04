const axios = require("axios");
const config = require("../config/config");
const systemUtils = require("../utils/system-utils");

/**
 * API服务模块 - 负责与服务器端通信
 */
class ApiService {
  constructor() {
    this.config = config;
    this.pollIntervals = {
      systemInfo: null,
      notifications: null,
    };
    this.notificationPollingInterval = null;
    this.isRegistered = false;
  }

  /**
   * 向服务器报告流信息
   * @param {Object} streamInfo 流信息
   * @returns {Promise} 请求Promise
   */
  async reportStreamInfo(streamInfo) {
    try {
      const { serverIp, serverPort, serverPassword } =
        this.config.getServerConfig();
      const { studentId, studentName } = this.config.getStudentInfo();
      const machineNumber = this.config.getServerConfig().machineNumber;

      if (!serverIp || !serverPort) {
        console.error("服务器地址或端口未配置，无法报告流信息");
        return false;
      }

      const url = `http://${serverIp}:${serverPort}/api/report-stream`;
      console.log(`向服务器报告流地址：${url}`);
      console.log("流信息：", streamInfo);

      // 按照服务端要求的格式组织数据
      const requestData = {
        machineNumber: machineNumber,
        password: serverPassword,
        rtmpUrl: streamInfo.screenUrl || streamInfo.rtmpUrl, // 屏幕流地址
        cameraUrl: streamInfo.cameraUrl || streamInfo.cameraRtmpUrl, // 摄像头流地址
        streamKey: streamInfo.streamKey || "",
        studentInfo: {
          studentId: studentId || "",
          studentName: studentName || "",
        },
      };

      console.log("发送请求数据：", JSON.stringify(requestData));

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Password": serverPassword, // 添加认证头
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        console.error(`报告流地址失败，状态码：${response.status}`);
        const errorData = await response.text();
        console.error(`错误详情：${errorData}`);
        return false;
      }

      const data = await response.json();
      console.log("报告流地址响应：", data);
      return true;
    } catch (error) {
      console.error("报告流地址时出错：", error.message);
      return false;
    }
  }

  /**
   * 向服务器报告系统信息
   * @returns {Promise} 请求Promise
   */
  async reportSystemInfo() {
    try {
      const { serverIp, serverPort, serverPassword, machineNumber } =
        this.config.getServerConfig();
      const { studentId, studentName } = this.config.getStudentInfo();

      if (!serverIp || !serverPort) {
        console.error("服务器地址或端口未配置，无法报告系统信息");
        return false;
      }

      // 获取最新的系统信息
      const systemInfo = systemUtils.getSystemInfo();

      const url = `http://${serverIp}:${serverPort}/api/report-system-info`;
      console.log(`向服务器报告系统信息：${url}`);

      // 按照服务端要求的格式组织数据
      const requestData = {
        machineNumber: machineNumber,
        password: serverPassword,
        systemInfo: {
          ipAddress: systemInfo.ipAddress,
          macAddress: systemInfo.macAddress,
          hostname: systemInfo.hostname,
          platform: systemInfo.platform,
          cpuUsage: systemInfo.cpuUsage,
          memoryUsage: systemInfo.memoryUsage,
          totalMemory: systemInfo.totalMemory,
          diskUsage: systemInfo.diskUsage,
          diskTotal: systemInfo.diskTotal,
          osVersion: systemInfo.osVersion,
        },
        studentInfo: {
          studentId: studentId || "",
          studentName: studentName || "",
        },
        timestamp: new Date().getTime(),
      };

      console.log("发送系统信息：", JSON.stringify(requestData));

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Password": serverPassword, // 添加认证头
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        console.error(`报告系统信息失败，状态码：${response.status}`);
        const errorData = await response.text();
        console.error(`错误详情：${errorData}`);
        return false;
      }

      const data = await response.json();
      console.log("报告系统信息响应：", data);
      return true;
    } catch (error) {
      console.error("报告系统信息时出错：", error.message);
      return false;
    }
  }

  /**
   * 从服务器获取通知
   * @returns {Promise} 包含通知数组的Promise
   */
  async getNotifications() {
    try {
      const { serverIp, serverPort, serverPassword, machineNumber } =
        this.config.getServerConfig();

      if (!serverIp || !serverPort) {
        console.error("服务器地址或端口未配置，无法获取通知");
        return [];
      }

      const url = `http://${serverIp}:${serverPort}/api/client-notifications?machineNumber=${machineNumber}`;
      console.log(`从服务器获取通知：${url}`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Auth-Password": serverPassword, // 添加认证头
        },
      });

      if (!response.ok) {
        console.error(`获取通知失败，状态码：${response.status}`);
        const errorData = await response.text();
        console.error(`错误详情：${errorData}`);
        return [];
      }

      const data = await response.json();

      if (data.status === "success" && Array.isArray(data.data)) {
        console.log(`获取到 ${data.data.length} 条通知`);
        return data.data;
      } else {
        console.error("通知数据格式不正确:", data);
        return [];
      }
    } catch (error) {
      console.error("获取通知时出错：", error.message);
      return [];
    }
  }

  /**
   * 开始定时向服务器报告系统信息
   * @param {number} interval 报告间隔（毫秒）
   */
  startSystemInfoReporting(interval = 30000) {
    if (this.pollIntervals.systemInfo) {
      clearInterval(this.pollIntervals.systemInfo);
    }

    this.pollIntervals.systemInfo = setInterval(() => {
      if (this.isRegistered) {
        this.reportSystemInfo().catch((err) => {
          console.warn("系统信息报告失败:", err.message);
        });
      }
    }, interval);
  }

  /**
   * 开始定期轮询服务器通知
   * @param {Function} notificationHandler 通知处理函数
   * @param {number} interval 检查间隔（毫秒）
   */
  startNotificationsPolling(notificationHandler, interval = 10000) {
    if (this.pollIntervals.notifications) {
      clearInterval(this.pollIntervals.notifications);
    }

    this.checkNotifications(notificationHandler);

    this.pollIntervals.notifications = setInterval(() => {
      this.checkNotifications(notificationHandler);
    }, interval);

    console.log(`已开始定期检查通知，间隔：${interval}ms`);
  }

  /**
   * 检查服务器通知
   * @param {Function} notificationHandler 通知处理函数
   */
  async checkNotifications(notificationHandler) {
    try {
      const notifications = await this.getNotifications();

      if (
        notifications &&
        notifications.length > 0 &&
        typeof notificationHandler === "function"
      ) {
        notificationHandler(notifications);
      }
    } catch (error) {
      console.error("检查通知时出错：", error.message);
    }
  }

  /**
   * 停止所有轮询
   */
  stopAllPolling() {
    Object.keys(this.pollIntervals).forEach((key) => {
      if (this.pollIntervals[key]) {
        clearInterval(this.pollIntervals[key]);
        this.pollIntervals[key] = null;
      }
    });
  }

  /**
   * 验证服务器连接
   * @param {string} serverIp 服务器IP
   * @param {number} serverPort 服务器端口
   * @returns {Promise} 验证结果
   */
  async verifyServerConnection(serverIp, serverPort) {
    if (!serverIp) {
      return Promise.reject(new Error("服务器IP不能为空"));
    }

    // 尝试的端口顺序：用户指定端口、8080（默认HTTP端口）、3000、8000
    const portsToTry = [
      serverPort || 8080,
      ...[8080, 3000, 8000].filter((p) => p !== (serverPort || 8080)),
    ];

    console.log(`开始验证服务器连接，尝试端口: ${portsToTry.join(", ")}`);

    // 依次尝试各端口
    for (const port of portsToTry) {
      try {
        const url = `http://${serverIp}:${port}/api/health-check`;
        console.log(`尝试连接: ${url}`);

        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 5000, // 设置超时
        });

        if (response.ok) {
          console.log(`成功连接到端口 ${port}`);
          return { success: true, port: port };
        }
      } catch (error) {
        console.log(`端口 ${port} 连接失败: ${error.message}`);
      }
    }

    return Promise.reject(new Error("无法连接到服务器，请检查IP地址和端口"));
  }

  async fetchWithAuth(url, method = "GET", body = null) {
    try {
      const { serverIp, serverPort, password } = config.getServerConfig();
      const fullUrl = `http://${serverIp}:${serverPort}${url}`;

      // 构建请求配置
      const axiosConfig = {
        method,
        url: fullUrl,
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Password": password,
        },
      };

      // 如果是GET请求，添加查询参数
      if (method === "GET") {
        axiosConfig.params = { password };
      }

      // 如果有请求体，添加到配置中
      if (body) {
        axiosConfig.data = {
          ...body,
          password,
        };
      }

      const response = await axios(axiosConfig);

      if (response.data.status !== "success") {
        throw new Error(`API请求失败: ${url}`);
      }

      return response.data;
    } catch (error) {
      console.error(`API请求失败: ${url}`, error);
      throw error;
    }
  }
}

module.exports = new ApiService();
