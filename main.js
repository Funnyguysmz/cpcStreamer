const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  dialog,
  globalShortcut,
  desktopCapturer,
} = require("electron");
const path = require("path");
const url = require("url");
const crypto = require("crypto-js");
const Store = require("electron-store");
const { v4: uuidv4 } = require("uuid");
const NodeMediaServer = require("node-media-server");
const axios = require("axios");
const os = require("os");
const { execSync, spawn } = require("child_process");
const fs = require("fs");

// 防止应用多开
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  return;
}

// 配置存储
const store = new Store({
  encryptionKey: "exam_monitor_key", // 加密密钥
  name: "config", // 配置文件名
});

// 应用状态
let mainWindow = null;
let tray = null;
let isQuitting = false;
let streamUrl = "";
let mediaServer = null;
let serverConfig = {
  serverIp: store.get("serverIp", ""),
  serverPassword: store.get("serverPassword", ""),
  machineNumber: store.get("machineNumber", ""),
};

// 添加全局变量来存储捕获和推流状态
let isCapturing = false;
let screenSource = null;
let cameraSource = null;
let ffmpegProcess = null;

// 检测FFmpeg是否安装
function checkFFmpeg() {
  let ffmpegPath = "";

  try {
    // 尝试运行ffmpeg命令
    const output = execSync("ffmpeg -version").toString();
    console.log("FFmpeg已安装:", output.split("\n")[0]);

    // 通过which/where命令找到路径
    try {
      if (process.platform === "win32") {
        ffmpegPath = execSync("where ffmpeg").toString().trim().split("\n")[0];
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
    dialog.showMessageBoxSync({
      type: "warning",
      title: "FFmpeg未找到",
      message:
        "FFmpeg未安装或无法访问，推流功能将不可用！\n请安装FFmpeg后重启应用。",
      buttons: ["确定"],
    });
    return "";
  }
}

// 添加创建临时媒体目录的函数
function createMediaRoot() {
  const mediaRoot = path.join(app.getPath("userData"), "media");

  // 确保media目录存在
  if (!fs.existsSync(mediaRoot)) {
    try {
      fs.mkdirSync(mediaRoot, { recursive: true });
      console.log("创建媒体根目录:", mediaRoot);
    } catch (err) {
      console.error("创建媒体根目录失败:", err);
    }
  }

  return mediaRoot;
}

// 初始化直播服务器
function initMediaServer() {
  const rtmpPort = 1935;
  const httpPort = 8000;

  // 检测FFmpeg
  const ffmpegPath = checkFFmpeg();

  // 创建媒体根目录
  const mediaRoot = createMediaRoot();

  const nmsConfig = {
    rtmp: {
      port: rtmpPort,
      chunk_size: 60000,
      gop_cache: true,
      ping: 30,
      ping_timeout: 60,
    },
    http: {
      port: httpPort,
      allow_origin: "*",
    },
    auth: {
      api: false,
      play: false,
      publish: false,
    },
    // 添加媒体根目录
    relay: {
      ffmpeg: ffmpegPath,
      tasks: [],
    },
    // 设置媒体根目录
    mediaroot: mediaRoot,
  };

  // 如果找到FFmpeg，添加转码配置
  if (ffmpegPath) {
    nmsConfig.trans = {
      ffmpeg: ffmpegPath,
      tasks: [
        {
          app: "live",
          hls: true,
          hlsFlags: "[hls_time=2:hls_list_size=3:hls_flags=delete_segments]",
          dash: true,
          dashFlags: "[f=dash:window_size=3:extra_window_size=5]",
        },
      ],
    };
  }

  mediaServer = new NodeMediaServer(nmsConfig);
  mediaServer.run();

  // 生成流地址
  const macAddress = getMacAddress();
  const streamKey = crypto
    .MD5(macAddress + uuidv4())
    .toString()
    .substring(0, 16);

  // 构建 RTMP 流地址 (OBS将推流到这个地址)
  streamUrl = `rtmp://localhost:${rtmpPort}/live/${streamKey}`;

  // 存储所有流地址
  let streamUrls = {
    rtmpUrl: streamUrl,
  };

  // 如果FFmpeg可用，添加其他格式的流地址
  if (ffmpegPath) {
    // 构建HTTP-FLV流地址 (服务器将从这里拉流)
    streamUrls.httpFlvUrl = `http://localhost:${httpPort}/flv/${streamKey}.flv`;

    // 构建HLS流地址 (服务器也可以从这里拉流)
    streamUrls.hlsUrl = `http://localhost:${httpPort}/hls/${streamKey}.m3u8`;

    // 构建DASH流地址 (服务器也可以从这里拉流)
    streamUrls.dashUrl = `http://localhost:${httpPort}/dash/${streamKey}.mpd`;

    console.log("RTMP直播流地址 (OBS推流用):", streamUrl);
    console.log("HTTP-FLV流地址 (服务器获取流用):", streamUrls.httpFlvUrl);
    console.log("HLS流地址 (服务器获取流用):", streamUrls.hlsUrl);
    console.log("DASH流地址 (服务器获取流用):", streamUrls.dashUrl);
  } else {
    console.log("RTMP直播流地址 (OBS推流用，也是服务器获取流用):", streamUrl);
  }

  // 将流地址发送给服务器
  sendStreamUrlToServer(streamUrls);

  return streamUrls;
}

// 获取MAC地址
function getMacAddress() {
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
}

// 将流地址发送给服务器
function sendStreamUrlToServer(streamUrls) {
  // 如果没有配置服务器地址，则跳过发送
  if (!serverConfig.serverIp || !serverConfig.machineNumber) {
    console.warn("服务器配置不完整，跳过流地址发送");
    return;
  }

  console.log("准备发送流地址到服务器:", streamUrls);

  // 获取本机IP地址，这样服务器可以通过这个IP访问HLS/HTTP-FLV流
  const localIp = getIpAddress();

  // 将localhost替换为本机实际IP，使服务器可以访问
  const publicStreamUrls = {
    rtmpUrl: streamUrls.rtmpUrl.replace("localhost", localIp),
    httpFlvUrl: streamUrls.httpFlvUrl?.replace("localhost", localIp),
    hlsUrl: streamUrls.hlsUrl?.replace("localhost", localIp),
    dashUrl: streamUrls.dashUrl?.replace("localhost", localIp),
  };

  console.log("发送给服务器的公网流地址:", publicStreamUrls);

  // 实际发送请求 - 修正API路径及请求格式
  axios
    .post(`http://${serverConfig.serverIp}:8080/api/report-stream`, {
      machineNumber: serverConfig.machineNumber,
      rtmpUrl: publicStreamUrls.rtmpUrl,
      cameraUrl: publicStreamUrls.httpFlvUrl || publicStreamUrls.hlsUrl || "", // 优先使用HTTP-FLV或HLS流作为摄像头流
      password: serverConfig.serverPassword,
      systemInfo: {
        macAddress: getMacAddress(),
        ipAddress: localIp,
      },
      studentInfo: {
        studentId: "", // 可以在这里添加学生ID
        studentName: "", // 可以在这里添加学生姓名
      },
    })
    .then((response) => {
      console.log("流地址发送成功", response.data);
    })
    .catch((error) => {
      console.error("流地址发送失败:", error);
    });
}

// 定期收集系统信息并发送到服务器
function startSystemMonitoring() {
  // 每30秒发送一次系统信息
  setInterval(() => {
    if (!serverConfig.serverIp || !serverConfig.machineNumber) {
      return;
    }

    const systemInfo = {
      machineNumber: serverConfig.machineNumber,
      password: serverConfig.serverPassword,
      systemInfo: {
        macAddress: getMacAddress(),
        ipAddress: getIpAddress(),
        hostName: os.hostname(),
        platform: os.platform(),
        osVersion: os.release(),
        cpuUsage: process.cpuUsage(),
        memoryUsage: process.memoryUsage(),
        // 添加其他系统信息字段以匹配服务端的模型
        arch: os.arch(),
        memoryTotal: `${Math.round(os.totalmem() / (1024 * 1024))}MB`,
        memoryFree: `${Math.round(os.freemem() / (1024 * 1024))}MB`,
      },
      studentInfo: {
        studentId: "",
        studentName: "",
      },
      timestamp: new Date().getTime(),
    };

    // 修正URL格式
    axios
      .post(
        `http://${serverConfig.serverIp}:8080/api/report-system-info`,
        systemInfo
      )
      .then((response) => {
        console.log("系统信息发送成功", response.data);
      })
      .catch((error) => {
        console.error("系统信息发送失败:", error);
      });
  }, 30000);
}

// 检查服务器通知
function checkServerNotifications() {
  // 每10秒检查一次通知
  setInterval(() => {
    if (!serverConfig.serverIp || !serverConfig.machineNumber) {
      return;
    }

    // 修正URL格式，使用正确的API路径和请求方式
    axios
      .get(
        `http://${serverConfig.serverIp}:8080/api/client-notifications?machineNumber=${serverConfig.machineNumber}&password=${serverConfig.serverPassword}`
      )
      .then((response) => {
        if (response.data.status === "success" && response.data.data) {
          processNotifications(response.data.data);
        }
      })
      .catch((error) => {
        console.error("获取通知失败:", error);
      });
  }, 10000);
}

// 获取IP地址
function getIpAddress() {
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
}

// 创建主窗口
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webSecurity: false, // 允许加载本地资源
    },
    icon: path.join(__dirname, "assets/icons/icon.png"),
  });

  // 加载初始页面
  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, "renderer/login.html"),
      protocol: "file:",
      slashes: true,
    })
  );

  // 阻止窗口关闭，而是最小化到托盘
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  // 窗口关闭时释放引用
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // 禁用默认菜单
  mainWindow.setMenu(null);
}

// 创建托盘图标
function createTray() {
  tray = new Tray(path.join(__dirname, "assets/icons/icon.png"));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示窗口",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
        }
      },
    },
    {
      label: "修改配置",
      click: () => {
        requestPassword("修改配置需要管理员密码", (success) => {
          if (success && mainWindow) {
            mainWindow.loadURL(
              url.format({
                pathname: path.join(__dirname, "renderer/settings.html"),
                protocol: "file:",
                slashes: true,
              })
            );
            mainWindow.show();
          }
        });
      },
    },
    { type: "separator" },
    {
      label: "退出应用",
      click: () => {
        requestPassword("退出应用需要管理员密码", (success) => {
          if (success) {
            isQuitting = true;
            if (mediaServer) {
              mediaServer.stop();
            }
            app.quit();
          }
        });
      },
    },
  ]);

  tray.setToolTip("考试监控客户端");
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

// 请求密码验证
function requestPassword(message, callback) {
  if (!mainWindow) {
    return;
  }

  dialog
    .showInputBox({
      title: "密码验证",
      message: message,
      placeholder: "请输入管理员密码",
      type: "password",
    })
    .then((result) => {
      const { response, checkboxChecked } = result;
      if (response) {
        // TODO: 实际项目中应向服务器验证密码
        const adminPassword = "admin123"; // 临时硬编码验证密码用于测试
        if (response === adminPassword) {
          callback(true);
        } else {
          dialog.showErrorBox("密码错误", "您输入的密码不正确");
          callback(false);
        }
      } else {
        callback(false);
      }
    });
}

// 全局禁用关闭快捷键
function disableShortcuts() {
  // 禁用 Alt+F4
  globalShortcut.register("Alt+F4", () => {
    // 不做任何事，拦截快捷键
    console.log("Alt+F4 被禁用");
  });

  // 禁用 Cmd+Q (macOS)
  globalShortcut.register("CommandOrControl+Q", () => {
    console.log("Cmd+Q 被禁用");
    return false;
  });
}

// 当应用就绪
app.whenReady().then(() => {
  createMainWindow();
  createTray();
  disableShortcuts();

  // 如果已经配置了服务器信息，直接初始化媒体服务器
  if (
    serverConfig.serverIp &&
    serverConfig.serverPassword &&
    serverConfig.machineNumber
  ) {
    initMediaServer();
    startSystemMonitoring();
  }
});

// 防止应用多开
app.on("second-instance", (event, commandLine, workingDirectory) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// macOS 下点击 dock 图标时重新打开窗口
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// IPC 通信处理
ipcMain.on("login-request", (event, data) => {
  const { serverIp, password, machineNumber } = data;

  // 保存配置
  store.set("serverIp", serverIp);
  store.set("serverPassword", password);
  store.set("machineNumber", machineNumber);

  serverConfig = {
    serverIp,
    serverPassword: password,
    machineNumber,
  };

  // TODO: 验证服务器连接
  // 这里为测试先直接返回成功
  event.reply("login-response", { success: true });

  // 初始化媒体服务器
  initMediaServer();
  startSystemMonitoring();

  // 导航到学生登录页面
  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, "renderer/student-login.html"),
      protocol: "file:",
      slashes: true,
    })
  );
});

// 学生登录请求
ipcMain.on("student-login", (event, data) => {
  const { studentId, studentName } = data;

  // 保存学生信息
  store.set("currentStudent", {
    studentId,
    studentName,
  });

  // 将学生信息发送给服务器
  console.log("学生登录:", studentId, studentName);

  // 登录成功后最小化到托盘
  event.reply("student-login-response", { success: true });

  // 导航到捕获页面
  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, "renderer/capture.html"),
      protocol: "file:",
      slashes: true,
    })
  );
});

// 获取机器号
ipcMain.on("get-machine-number", (event) => {
  event.reply("machine-number", serverConfig.machineNumber);
});

// 获取当前配置
ipcMain.on("get-current-settings", (event) => {
  event.reply("current-settings", serverConfig);
});

// 获取系统信息
ipcMain.on("get-system-info", (event) => {
  // 检查FFmpeg是否可用
  let ffmpegInstalled = false;
  try {
    execSync("ffmpeg -version");
    ffmpegInstalled = true;
  } catch (err) {
    ffmpegInstalled = false;
  }

  // 基本流地址信息
  const streamUrls = {
    rtmpUrl: streamUrl || "",
  };

  // 如果FFmpeg已安装且有streamUrl，添加其他流地址
  if (ffmpegInstalled && streamUrl) {
    const streamKey = streamUrl.split("/").pop();
    streamUrls.httpFlvUrl = `http://localhost:8000/flv/${streamKey}.flv`;
    streamUrls.hlsUrl = `http://localhost:8000/hls/${streamKey}.m3u8`;
    streamUrls.dashUrl = `http://localhost:8000/dash/${streamKey}.mpd`;
  }

  const systemInfo = {
    macAddress: getMacAddress(),
    ipAddress: getIpAddress(),
    streamUrls: streamUrls,
    ffmpegInstalled: ffmpegInstalled,
  };

  event.reply("system-info", systemInfo);
});

// 保存设置
ipcMain.on("save-settings", (event, data) => {
  const { serverIp, password, machineNumber } = data;

  // 保存配置
  store.set("serverIp", serverIp);
  store.set("serverPassword", password);
  store.set("machineNumber", machineNumber);

  serverConfig = {
    serverIp,
    serverPassword: password,
    machineNumber,
  };

  // 如果媒体服务器已启动，重启它
  if (mediaServer) {
    mediaServer.stop();
    initMediaServer();
  }

  event.reply("save-settings-response", { success: true });
});

// 设置页面返回
ipcMain.on("settings-back", (event) => {
  // 返回学生登录页面
  if (mainWindow) {
    mainWindow.loadURL(
      url.format({
        pathname: path.join(__dirname, "renderer/student-login.html"),
        protocol: "file:",
        slashes: true,
      })
    );
  }
});

// 确保应用退出前关闭媒体服务器
app.on("before-quit", () => {
  isQuitting = true;
  if (mediaServer) {
    mediaServer.stop();
  }
});

// 注销所有快捷键
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// 创建一个临时目录来存储捕获的视频
function createTempDir() {
  const tempDir = path.join(os.tmpdir(), "exam-monitor-temp");

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  return tempDir;
}

// 使用FFmpeg推流到RTMP服务器
function startRtmpStream(streamInfo) {
  // 检查FFmpeg是否可用
  const ffmpegPath = checkFFmpeg();
  if (!ffmpegPath) {
    dialog.showMessageBoxSync({
      type: "error",
      title: "无法推流",
      message: "未找到FFmpeg，无法进行RTMP推流！",
      buttons: ["确定"],
    });
    return false;
  }

  // 创建临时目录
  const tempDir = createTempDir();

  // 屏幕视频存储路径
  const screenVideo = path.join(tempDir, "screen.webm");
  // 摄像头视频存储路径
  const cameraVideo = path.join(tempDir, "camera.webm");

  // 检查文件是否存在的逻辑
  const checkFileInterval = setInterval(() => {
    try {
      let screenExists = fs.existsSync(screenVideo);
      let cameraExists = fs.existsSync(cameraVideo);

      console.log(
        `检查文件: 屏幕视频存在: ${screenExists}, 摄像头视频存在: ${cameraExists}`
      );

      // 如果文件已经创建，开始推流并清除定时器
      if (screenExists) {
        clearInterval(checkFileInterval);
        startFFmpegStream(
          screenVideo,
          cameraExists ? cameraVideo : null,
          streamInfo.rtmpUrl
        );
      }
    } catch (err) {
      console.error("检查文件时出错:", err);
    }
  }, 1000); // 每秒检查一次

  // 5秒后如果仍未发现文件，清除定时器并报告错误
  setTimeout(() => {
    if (checkFileInterval) {
      clearInterval(checkFileInterval);
      console.error("5秒后仍未找到录制文件，放弃等待");
      dialog.showMessageBoxSync({
        type: "warning",
        title: "推流警告",
        message: "未能找到录制文件，推流可能无法正常工作",
        buttons: ["确定"],
      });
    }
  }, 5000);

  return true;
}

// 启动FFmpeg推流进程
function startFFmpegStream(screenFile, cameraFile, rtmpUrl) {
  console.log(`开始推流: ${screenFile} -> ${rtmpUrl}`);

  // FFmpeg命令参数
  let ffmpegArgs = [];

  if (cameraFile) {
    // 如果有摄像头视频，使用复杂过滤器做画中画
    ffmpegArgs = [
      "-re", // 以实时速率读取输入
      "-i",
      screenFile, // 输入屏幕视频
      "-i",
      cameraFile, // 输入摄像头视频
      "-filter_complex",
      "[0:v]scale=1280:720[bg];[1:v]scale=320:240[overlay];[bg][overlay]overlay=main_w-overlay_w-10:main_h-overlay_h-10", // 画中画效果
      "-c:v",
      "libx264", // 视频编码器
      "-preset",
      "veryfast", // 编码速度
      "-b:v",
      "2500k", // 视频比特率
      "-maxrate",
      "2500k",
      "-bufsize",
      "5000k",
      "-g",
      "60", // 关键帧间隔
      "-c:a",
      "aac", // 音频编码器
      "-b:a",
      "128k", // 音频比特率
      "-ar",
      "44100", // 音频采样率
      "-f",
      "flv", // 输出格式
      rtmpUrl, // 输出RTMP URL
    ];
  } else {
    // 如果只有屏幕视频，简化命令
    ffmpegArgs = [
      "-re", // 以实时速率读取输入
      "-i",
      screenFile, // 输入屏幕视频
      "-c:v",
      "libx264", // 视频编码器
      "-preset",
      "veryfast", // 编码速度
      "-b:v",
      "2500k", // 视频比特率
      "-maxrate",
      "2500k",
      "-bufsize",
      "5000k",
      "-g",
      "60", // 关键帧间隔
      "-c:a",
      "aac", // 音频编码器
      "-b:a",
      "128k", // 音频比特率
      "-ar",
      "44100", // 音频采样率
      "-f",
      "flv", // 输出格式
      rtmpUrl, // 输出RTMP URL
    ];
  }

  // 如果ffmpegProcess已存在，先停止它
  if (ffmpegProcess) {
    stopRtmpStream();
  }

  // 启动FFmpeg进程
  ffmpegProcess = spawn(checkFFmpeg(), ffmpegArgs);

  // 监听FFmpeg输出
  ffmpegProcess.stdout.on("data", (data) => {
    console.log(`FFmpeg stdout: ${data}`);
  });

  ffmpegProcess.stderr.on("data", (data) => {
    console.log(`FFmpeg stderr: ${data}`);
  });

  // 监听进程退出
  ffmpegProcess.on("close", (code) => {
    console.log(`FFmpeg进程退出，退出码: ${code}`);
    ffmpegProcess = null;
  });

  return true;
}

// 停止RTMP推流
function stopRtmpStream() {
  if (ffmpegProcess) {
    console.log("停止推流进程");

    // 在Windows上，使用taskkill强制终止进程
    if (process.platform === "win32") {
      try {
        execSync(`taskkill /pid ${ffmpegProcess.pid} /f /t`);
      } catch (error) {
        console.error("停止FFmpeg进程时出错:", error);
      }
    } else {
      // 在其他平台上使用kill信号
      try {
        ffmpegProcess.kill("SIGTERM");
      } catch (error) {
        console.error("停止FFmpeg进程时出错:", error);
      }
    }

    ffmpegProcess = null;
  }
}

// 添加新的IPC处理程序，用于开始/停止屏幕和摄像头捕获
ipcMain.on("start-capture", async (event, data) => {
  try {
    if (isCapturing) {
      console.log("已经在捕获中...");
      event.reply("capture-status", {
        success: true,
        message: "已经在捕获中",
      });
      return;
    }

    const { rtmpServerUrl } = data;

    if (!rtmpServerUrl) {
      event.reply("capture-status", {
        success: false,
        message: "缺少RTMP服务器地址",
      });
      return;
    }

    // 生成一个唯一的流密钥
    const streamKey = crypto
      .MD5(getMacAddress() + uuidv4())
      .toString()
      .substring(0, 16);

    // 完整的RTMP地址
    const fullRtmpUrl = `${rtmpServerUrl}/${streamKey}`;

    console.log("开始捕获并推流到:", fullRtmpUrl);

    // 通知渲染进程开始捕获媒体
    mainWindow.webContents.send("do-capture-media", {
      rtmpUrl: fullRtmpUrl,
    });

    // 更新状态
    isCapturing = true;

    // 开始推流
    const streamStarted = startRtmpStream({
      rtmpUrl: fullRtmpUrl,
    });

    if (!streamStarted) {
      event.reply("capture-status", {
        success: false,
        message: "推流启动失败，请确保安装了FFmpeg",
      });
      return;
    }

    // 将流地址发送到服务器
    sendStreamInfoToServer({
      streamKey: streamKey,
      rtmpUrl: fullRtmpUrl,
      machineNumber: serverConfig.machineNumber,
      studentInfo: store.get("currentStudent", {}),
    });

    event.reply("capture-status", {
      success: true,
      message: "捕获已开始",
    });
  } catch (error) {
    console.error("开始捕获时出错:", error);
    event.reply("capture-status", {
      success: false,
      message: `捕获失败: ${error.message}`,
    });
  }
});

// 停止捕获
ipcMain.on("stop-capture", (event) => {
  try {
    if (!isCapturing) {
      console.log("当前没有进行捕获...");
      event.reply("capture-status", {
        success: true,
        message: "当前没有进行捕获",
      });
      return;
    }

    // 停止推流
    stopRtmpStream();

    // 通知渲染进程停止捕获
    mainWindow.webContents.send("do-stop-capture");

    // 更新状态
    isCapturing = false;

    event.reply("capture-status", {
      success: true,
      message: "捕获已停止",
    });
  } catch (error) {
    console.error("停止捕获时出错:", error);
    event.reply("capture-status", {
      success: false,
      message: `停止失败: ${error.message}`,
    });
  }
});

// 接收来自渲染进程的捕获状态更新
ipcMain.on("capture-status-update", (event, status) => {
  console.log("捕获状态更新:", status);
  isCapturing = status.isCapturing;
});

// 发送流信息到服务器
function sendStreamInfoToServer(streamInfo) {
  // 如果没有配置服务器地址，则跳过发送
  if (!serverConfig.serverIp || !serverConfig.machineNumber) {
    console.warn("服务器配置不完整，跳过流信息发送");
    return;
  }

  console.log("准备发送流信息到服务器:", streamInfo);

  // 获取本机IP地址和MAC地址
  const localIp = getIpAddress();
  const macAddress = getMacAddress();

  // 构建要发送的数据 (确保与服务端 StreamRequest 结构保持一致)
  const dataToSend = {
    machineNumber: serverConfig.machineNumber,
    streamKey: streamInfo.streamKey || "",
    rtmpUrl: streamInfo.rtmpUrl || "",
    cameraUrl: streamInfo.cameraUrl || "",
    password: serverConfig.serverPassword,
    systemInfo: {
      macAddress: macAddress,
      ipAddress: localIp,
      hostName: os.hostname(),
      platform: os.platform(),
      osVersion: os.release(),
      arch: os.arch(),
      memoryTotal: `${Math.round(os.totalmem() / (1024 * 1024))}MB`,
      memoryFree: `${Math.round(os.freemem() / (1024 * 1024))}MB`,
    },
    studentInfo: {
      studentId: streamInfo.studentInfo?.studentId || "",
      studentName: streamInfo.studentInfo?.studentName || "",
    },
  };

  // 发送请求到服务器
  axios
    .post(`http://${serverConfig.serverIp}:8080/api/report-stream`, dataToSend)
    .then((response) => {
      console.log("流信息发送成功", response.data);
    })
    .catch((error) => {
      console.error("流信息发送失败:", error);
    });
}

// 添加处理通知的函数
function processNotifications(notifications) {
  if (!Array.isArray(notifications) || notifications.length === 0) {
    return;
  }
  
  console.log(`收到 ${notifications.length} 条通知:`, notifications);
  
  // 仅处理针对本机的通知或发给所有人的通知
  const machineNumber = serverConfig.machineNumber;
  const relevantNotifications = notifications.filter(
    (notification) =>
      !notification.machineNumber ||
      notification.machineNumber === machineNumber ||
      notification.machineNumber === "*"
  );

  // 显示通知
  relevantNotifications.forEach((notification) => {
    try {
      if (mainWindow) {
        // 根据通知级别确定对话框类型
        let messageType = "info";
        if (notification.level === "warning") {
          messageType = "warning";
        } else if (notification.level === "error") {
          messageType = "error";
        }

        // 显示系统通知
        dialog.showMessageBox({
          type: messageType,
          title: "考试监控系统通知",
          message: notification.message,
          buttons: ["确定"],
        });
      }
    } catch (err) {
      console.error("显示通知对话框时出错:", err);
    }
  });
}
