const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  dialog,
  globalShortcut,
  desktopCapturer
} = require("electron");
const path = require("path");
const url = require("url");
const fs = require("fs");

// 应用补丁
const applyPatches = require("./patches/apply-patches");
applyPatches();

// 导入模块
const config = require("./config/config");
const systemUtils = require("./utils/system-utils");
const mediaService = require("./services/media-service");
const apiService = require("./services/api-service");

// 防止应用多开
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  return;
}

// 应用状态
let mainWindow = null;
let tray = null;
let isQuitting = false;

// 创建一个临时图标文件
function createTempIcon() {
  const iconDir = path.join(__dirname, "assets/icons");
  const iconPath = path.join(iconDir, "icon.png");

  if (!fs.existsSync(iconDir)) {
    fs.mkdirSync(iconDir, { recursive: true });
  }

  // 如果图标文件不存在，创建一个简单的图标
  if (!fs.existsSync(iconPath)) {
    const defaultIconPath = path.join(app.getPath("temp"), "default-icon.png");
    try {
      // 这里可以生成一个简单的图标，或者从其他位置复制一个
      // 为简单起见，这里我们使用一个空文件
      fs.writeFileSync(iconPath, "");
      console.log("创建临时图标文件:", iconPath);
    } catch (err) {
      console.error("创建图标文件失败:", err);
    }
  }

  return iconPath;
}

// 创建主窗口
function createMainWindow() {
  const iconPath = createTempIcon();

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webSecurity: false,
    },
    icon: iconPath,
  });

  // 加载登录页面
  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, "../renderer/login.html"),
      protocol: "file:",
      slashes: true,
    })
  );

  // 监听登录成功事件
  ipcMain.on("login-success", () => {
    // 登录成功后自动最小化
    mainWindow.minimize();
    // 启动捕获和推流
    startMediaCaptureAndReporting();
  });

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
  const iconPath = path.join(__dirname, "assets", "icons", "icon.png");

  // 检查图标文件是否存在
  if (!fs.existsSync(iconPath)) {
    console.error(`图标文件不存在: ${iconPath}`);
    // 使用内置默认图标
    tray = new Tray(path.join(__dirname, "assets", "default-icon.png"));
    if (!fs.existsSync(path.join(__dirname, "assets", "default-icon.png"))) {
      // 如果默认图标也不存在，就使用空图标
      tray = new Tray();
      console.warn("使用空图标创建系统托盘");
    }
  } else {
    tray = new Tray(path.join(__dirname, "assets", "icons", "icon.png"));
    if (!fs.existsSync(path.join(__dirname, "assets", "icons", "icon.png"))) {
      // 如果图标不存在，就使用空图标
      tray = new Tray();
      console.warn("使用空图标创建系统托盘");
    }
  }

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
                pathname: path.join(__dirname, "../renderer/settings.html"),
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
            mediaService.stopMediaServer();
            apiService.stopAllPolling();
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
    .showMessageBox({
      type: "question",
      buttons: ["确定", "取消"],
      defaultId: 0,
      title: "密码验证",
      message: message,
      detail: "请输入管理员密码:",
      inputField: {
        type: "password",
        placeholder: "请输入密码",
      },
    })
    .then(({ response, checkboxChecked, inputField }) => {
      if (response === 0 && inputField) {
        // 临时用硬编码密码验证，实际应该向服务器验证
        const adminPassword = "admin123";
        if (inputField === adminPassword) {
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
    console.log("Alt+F4 被禁用");
    return false;
  });

  // 禁用 Cmd+Q (macOS)
  globalShortcut.register("CommandOrControl+Q", () => {
    console.log("Cmd+Q 被禁用");
    return false;
  });
}

// 处理通知
function processNotifications(notifications) {
  // 仅处理针对本机的通知或发给所有人的通知
  const machineNumber = config.getServerConfig().machineNumber;
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

// 登录成功后开始媒体捕获和推流
async function startMediaCaptureAndReporting() {
  try {
    console.log("开始初始化媒体捕获和推流...");

    // 在macOS上请求屏幕录制和摄像头权限
    if (process.platform === "darwin") {
      try {
        const { systemPreferences } = require("electron");
        if (systemPreferences) {
          // 检查屏幕录制权限状态
          if (systemPreferences.getMediaAccessStatus) {
            const screenStatus =
              systemPreferences.getMediaAccessStatus("screen");
            console.log("屏幕录制权限状态:", screenStatus);

            // 如果没有授权，尝试请求权限
            if (screenStatus !== "granted") {
              try {
                console.log("尝试请求屏幕录制权限...");
                await systemPreferences.askForMediaAccess("screen");
                console.log("屏幕录制权限已请求");
              } catch (err) {
                console.error("请求屏幕录制权限失败:", err);
                dialog.showMessageBox({
                  type: "warning",
                  title: "需要屏幕录制权限",
                  message: "请在系统偏好设置中允许此应用录制屏幕",
                  buttons: ["确定"],
                });
              }
            }

            // 检查摄像头权限状态
            const cameraStatus =
              systemPreferences.getMediaAccessStatus("camera");
            console.log("摄像头权限状态:", cameraStatus);

            // 如果没有授权，尝试请求权限
            if (cameraStatus !== "granted") {
              try {
                console.log("尝试请求摄像头权限...");
                await systemPreferences.askForMediaAccess("camera");
                console.log("摄像头权限已请求");
              } catch (err) {
                console.error("请求摄像头权限失败:", err);
                // 摄像头权限不是必须的，可以继续
              }
            }
          }
        }
      } catch (error) {
        console.error("请求媒体权限时出错:", error);
      }
    }

    // 1. 初始化媒体服务器
    console.log("初始化媒体服务器...");
    const streamInfo = mediaService.initMediaServer();
    console.log("媒体服务器初始化完成，获取到流地址:", streamInfo);

    if (!streamInfo || !streamInfo.screenUrl) {
      console.error("未获取到有效的流地址，无法继续");
      dialog.showMessageBox({
        type: "error",
        title: "初始化失败",
        message: "未能获取有效的流地址，请检查网络和防火墙设置",
        buttons: ["确定"],
      });
      return false;
    }

    // 2. 先向服务器报告流信息
    try {
      console.log("向服务器报告流信息...");
      await apiService.reportStreamInfo(streamInfo);
      console.log("流信息已成功报告给服务器");
    } catch (error) {
      console.error("向服务器报告流信息失败:", error);
      dialog
        .showMessageBox({
          type: "warning",
          title: "服务器通信警告",
          message: "无法向服务器报告流信息，请检查网络连接",
          buttons: ["继续", "取消"],
        })
        .then((result) => {
          if (result.response !== 0) {
            return false;
          }
        });
    }

    // 显示可用的捕获设备
    console.log("列出可用的捕获设备...");
    mediaService.listCaptureDevices();

    // 3. 开始屏幕和摄像头捕获
    console.log("开始屏幕和摄像头捕获...");
    const captureResult = mediaService.startCapture();

    if (!captureResult) {
      console.error("启动捕获失败");
      dialog.showMessageBox({
        type: "error",
        title: "捕获失败",
        message: "无法启动屏幕和摄像头捕获，请检查系统权限和FFmpeg安装",
        buttons: ["确定"],
      });
      return false;
    }

    console.log("屏幕和摄像头捕获已启动");

    // 4. 开始定期上报系统信息
    console.log("开始定期报告系统信息...");
    apiService.startSystemInfoReporting(30000);

    // 5. 开始定期检查服务器通知
    console.log("开始定期检查服务器通知...");
    apiService.startNotificationsPolling(handleServerNotifications, 10000);

    // 等待3秒确保捕获开始，然后再检查状态
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 再次显示流信息，确认流是否正在推送
    const finalStreamInfo = mediaService.displayStreamInfo();
    console.log("推流已启动，流信息:", finalStreamInfo);

    return true;
  } catch (error) {
    console.error("启动媒体捕获和报告失败:", error.message);
    // 尝试显示错误对话框
    try {
      dialog.showMessageBox({
        type: "error",
        title: "启动错误",
        message: "无法启动媒体捕获和报告",
        detail: error.message,
        buttons: ["确定"],
      });
    } catch (dialogError) {
      console.error("显示错误对话框失败:", dialogError);
    }
    return false;
  }
}

// 处理服务器通知
function handleServerNotifications(notifications) {
  if (!notifications || notifications.length === 0) return;

  notifications.forEach((notification) => {
    dialog.showMessageBox({
      type: notification.type || "info",
      title: "来自服务器的通知",
      message: notification.title || "通知",
      detail: notification.message || "",
      buttons: ["确定"],
    });
  });
}

ipcMain.handle('get-desktop-sources', async (event, options) => {
  console.log('IPC: Received request for get-desktop-sources with options:', options);
  try {
    const sources = await desktopCapturer.getSources(options);
    console.log('IPC: Returning sources:', sources.map(s => s.name));
    return sources;
  } catch (error) {
    console.error('IPC: Error getting desktop sources:', error);
    // 将错误信息传递给渲染进程
    // 注意：直接传递 Error 对象可能效果不好，传递错误消息字符串
    throw new Error(`Failed to get desktop sources: ${error.message}`);
  }
});

// 当应用就绪
app.whenReady().then(() => {
  createMainWindow();
  createTray();
  disableShortcuts();

  // 如果已经配置了服务器信息，直接初始化媒体服务器
  const serverConfig = config.getServerConfig();
  if (
    serverConfig.serverIp &&
    serverConfig.serverPassword &&
    serverConfig.machineNumber
  ) {
    mediaService.initMediaServer();
    apiService.startSystemInfoReporting();
    apiService.startNotificationsPolling(processNotifications);
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
  const { serverIp, serverPort, password, machineNumber } = data;

  // 验证服务器连接
  apiService
    .verifyServerConnection(serverIp, serverPort)
    .then((result) => {
      if (result.success) {
        // 更新配置，保存实际可用的端口
        config.setServerConfig({
          serverIp,
          serverPort: result.port, // 使用找到的可用端口
          serverPassword: password,
          machineNumber,
        });

        // 初始化媒体服务器
        mediaService.initMediaServer();

        // 启动系统监控
        apiService.startSystemInfoReporting();

        // 启动通知轮询
        apiService.startNotificationsPolling(processNotifications);

        // 回复登录成功
        event.reply("login-response", {
          success: true,
          // 如果端口与用户输入不同，通知用户
          message:
            result.port !== serverPort
              ? `已连接到端口 ${result.port}（原端口 ${serverPort} 不可用）`
              : "连接成功",
        });

        // 导航到学生登录页面
        mainWindow.loadURL(
          url.format({
            pathname: path.join(__dirname, "../renderer/student-login.html"),
            protocol: "file:",
            slashes: true,
          })
        );
      } else {
        event.reply("login-response", {
          success: false,
          message: "无法连接到服务器，请检查服务器地址和端口",
        });
      }
    })
    .catch((err) => {
      event.reply("login-response", { success: false, message: err.message });
    });
});

// 学生登录请求
ipcMain.on("student-login", async (event, data) => {
  const { studentId, studentName } = data;

  // 保存学生信息
  config.setStudentInfo({
    studentId,
    studentName,
  });

  // 登录成功后响应
  event.reply("student-login-response", { success: true });

  // 导航到捕获页面
  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, "../renderer/capture.html"),
      protocol: "file:",
      slashes: true,
    })
  );

  // 等待页面加载完成
  mainWindow.webContents.once("did-finish-load", async () => {
    console.log("捕获页面加载完成，准备开始捕获");

    // 在macOS上请求屏幕录制权限
    if (process.platform === "darwin") {
      try {
        // 请求屏幕录制权限
        const { systemPreferences } = require("electron");
        if (systemPreferences && systemPreferences.getMediaAccessStatus) {
          const screenStatus = systemPreferences.getMediaAccessStatus("screen");
          const cameraStatus = systemPreferences.getMediaAccessStatus("camera");

          console.log("屏幕录制权限状态:", screenStatus);
          console.log("摄像头权限状态:", cameraStatus);

          if (screenStatus !== "granted") {
            console.log("请求屏幕录制权限...");
            try {
              await systemPreferences.askForMediaAccess("screen");
              console.log("屏幕录制权限已请求");
            } catch (err) {
              console.error("屏幕录制权限请求失败:", err);
            }
          }

          if (cameraStatus !== "granted") {
            console.log("请求摄像头权限...");
            try {
              await systemPreferences.askForMediaAccess("camera");
              console.log("摄像头权限已请求");
            } catch (err) {
              console.error("摄像头权限请求失败:", err);
            }
          }
        }
      } catch (error) {
        console.error("请求媒体权限时出错:", error);
      }
    }

    // 开始媒体捕获和推流
    const result = await startMediaCaptureAndReporting();

    if (result) {
      console.log("媒体捕获和推流已启动，准备最小化窗口");

      // 显示流信息供调试使用
      mediaService.displayStreamInfo();

      // 确保窗口最小化到托盘
      setTimeout(() => {
        if (mainWindow) {
          console.log("最小化窗口到托盘");
          mainWindow.minimize();
          // 在某些系统上，可能需要额外隐藏窗口
          setTimeout(() => {
            if (mainWindow) {
              console.log("隐藏窗口");
              mainWindow.hide();
            }
          }, 500);
        }
      }, 1000);
    } else {
      console.error("媒体捕获和推流启动失败");
      dialog.showMessageBox({
        type: "error",
        title: "启动失败",
        message: "媒体捕获和推流启动失败",
        detail: "请检查系统权限和FFmpeg安装状态",
        buttons: ["确定"],
      });
    }
  });
});

// 获取机器号
ipcMain.on("get-machine-number", (event) => {
  event.reply("machine-number", config.getServerConfig().machineNumber);
});

// 获取当前配置
ipcMain.on("get-current-settings", (event) => {
  event.reply("current-settings", config.getServerConfig());
});

// 获取系统信息
ipcMain.on("get-system-info", (event) => {
  // 检查FFmpeg是否可用
  let ffmpegInstalled = systemUtils.checkFFmpeg() !== null;

  // 获取流地址
  const streamUrls = mediaService.getStreamUrls();

  // 系统信息
  const systemInfo = {
    ...systemUtils.getSystemInfo(),
    streamUrls: streamUrls,
    ffmpegInstalled: ffmpegInstalled,
  };

  event.reply("system-info", systemInfo);
});

// 保存设置
ipcMain.on("save-settings", (event, data) => {
  const { serverIp, serverPort, password, machineNumber } = data;

  // 验证服务器连接
  apiService
    .verifyServerConnection(serverIp, serverPort)
    .then((result) => {
      // 保存配置
      config.setServerConfig({
        serverIp,
        serverPort: result.success ? result.port : serverPort, // 使用找到的可用端口或原端口
        serverPassword: password,
        machineNumber,
      });

      // 如果媒体服务器已启动，重启它
      if (mediaService.nms) {
        mediaService.stopMediaServer();
        mediaService.initMediaServer();
      }

      event.reply("save-settings-response", {
        success: true,
        message:
          result.success && result.port !== serverPort
            ? `设置已保存，使用端口 ${result.port}（原端口 ${serverPort} 不可用）`
            : "设置已保存",
      });
    })
    .catch((err) => {
      // 即使无法连接服务器，也保存设置
      config.setServerConfig({
        serverIp,
        serverPort,
        serverPassword: password,
        machineNumber,
      });

      event.reply("save-settings-response", {
        success: true,
        message: "设置已保存，但无法连接到服务器",
      });
    });
});

// 设置页面返回
ipcMain.on("settings-back", (event) => {
  // 返回学生登录页面
  if (mainWindow) {
    mainWindow.loadURL(
      url.format({
        pathname: path.join(__dirname, "../renderer/student-login.html"),
        protocol: "file:",
        slashes: true,
      })
    );
  }
});

// 开始捕获
ipcMain.on("start-capture", (event, data) => {
  try {
    if (mediaService.isCapturing) {
      event.reply("capture-status", {
        success: true,
        message: "已经在捕获中",
      });
      return;
    }

    // 开始捕获
    const success = mediaService.startCapture();

    if (success) {
      // 获取流地址
      const streamUrls = mediaService.getStreamUrls();

      // 向服务器报告流地址
      apiService
        .reportStreamInfo(streamUrls)
        .then(() => {
          console.log("捕获开始并报告成功");
        })
        .catch((err) => {
          console.warn("捕获开始但报告失败:", err.message);
        });

      event.reply("capture-status", {
        success: true,
        message: "捕获已开始",
      });
    } else {
      event.reply("capture-status", {
        success: false,
        message: "推流启动失败，请确保安装了FFmpeg",
      });
    }
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
    if (!mediaService.isCapturing) {
      event.reply("capture-status", {
        success: true,
        message: "当前没有进行捕获",
      });
      return;
    }

    // 停止捕获
    mediaService.stopCapture();

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

// 确保应用退出前清理资源
app.on("before-quit", () => {
  isQuitting = true;
  mediaService.stopMediaServer();
  apiService.stopAllPolling();
});

// 注销所有快捷键
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
