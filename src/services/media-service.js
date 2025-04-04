const NodeMediaServer = require("node-media-server");
const { spawn, execSync } = require("child_process");
const systemUtils = require("../utils/system-utils");
const config = require("../config/config");
const { dialog } = require("electron");
const path = require("path");
const fs = require("fs");

/**
 * 媒体服务模块 - 负责管理媒体服务器和推流操作
 */
class MediaService {
  constructor() {
    this.mediaServer = null;
    this.screenProcess = null;
    this.cameraProcess = null;
    this.isCapturing = false;
    this.streamKey = null;
    this.screenStreamUrl = null;
    this.cameraStreamUrl = null;
    this.config = config.getMediaConfig();
    this.appDataPath = systemUtils.getAppDataPath();
    this.ffmpegPath = systemUtils.checkFFmpeg();
  }

  /**
   * 初始化媒体服务器
   * @returns {Object} 包含流地址的对象
   */
  initMediaServer() {
    // 如果已经初始化过媒体服务器，直接返回现有的流地址
    if (this.nms && this.streamKey) {
      console.log("媒体服务器已初始化，返回现有流地址");
      return this.getStreamUrls();
    }

    const { rtmpPort, httpPort } = this.config;

    // 检查RTMP端口是否可用
    try {
      const checkPortProcess = execSync(
        `lsof -i:${rtmpPort} || echo "Port available"`,
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }
      );

      if (!checkPortProcess.includes("Port available")) {
        console.warn(`RTMP端口 ${rtmpPort} 已被占用，尝试使用不同端口`);
        this.config.rtmpPort = 1936; // 尝试使用另一个端口
      }
    } catch (error) {
      // 忽略错误，继续尝试启动服务器
      console.log("端口检查出错，继续尝试启动服务器");
    }

    // 确保媒体存储目录存在
    const mediaRoot = path.join(this.appDataPath, "media");
    if (!fs.existsSync(mediaRoot)) {
      fs.mkdirSync(mediaRoot, { recursive: true });
    }

    const nmsConfig = {
      logType: 3, // 输出到控制台
      rtmp: {
        port: this.config.rtmpPort,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60,
      },
      http: {
        port: httpPort,
        allow_origin: "*",
        mediaroot: mediaRoot, // 指定媒体根目录
      },
      trans: {
        ffmpeg: this.ffmpegPath,
        tasks: [], // 暂时不设置转码任务
      },
    };

    this.nms = new NodeMediaServer(nmsConfig);

    // 避免调用不存在的getFFmpegVersion函数
    try {
      this.nms.run();
    } catch (error) {
      console.error("启动媒体服务器出错:", error);
      // 尝试不使用转码功能启动
      const basicConfig = {
        logType: 3,
        rtmp: {
          port: this.config.rtmpPort,
          chunk_size: 60000,
          gop_cache: true,
          ping: 30,
          ping_timeout: 60,
        },
        http: {
          port: httpPort,
          allow_origin: "*",
          mediaroot: mediaRoot,
        },
      };
      this.nms = new NodeMediaServer(basicConfig);
      this.nms.run();
    }

    console.log(`RTMP服务器已启动: rtmp://localhost:${this.config.rtmpPort}`);
    console.log(`HTTP-FLV服务器已启动: http://localhost:${httpPort}`);

    // 列出系统上的可用捕获设备（对调试有帮助）
    this.listCaptureDevices();

    // 生成流密钥和地址
    this.streamKey = systemUtils.generateStreamKey();
    this.screenStreamUrl = `rtmp://localhost:${this.config.rtmpPort}/live/${this.streamKey}`;
    this.cameraStreamUrl = `rtmp://localhost:${this.config.rtmpPort}/camera/${this.streamKey}`;

    console.log(`已生成屏幕推流地址: ${this.screenStreamUrl}`);
    console.log(`已生成摄像头推流地址: ${this.cameraStreamUrl}`);

    // 在macOS上打开防火墙端口
    if (process.platform === "darwin") {
      try {
        console.log(
          `尝试打开RTMP端口 ${this.config.rtmpPort} 和HTTP端口 ${httpPort}`
        );
        execSync(
          `sudo -n lsof -i:${this.config.rtmpPort} || echo "No need to open port"`
        );
        execSync(`sudo -n lsof -i:${httpPort} || echo "No need to open port"`);
      } catch (error) {
        // 忽略错误，不要求用户输入密码
        console.log("检查端口时出错，继续执行");
      }
    }

    // 获取公网可访问的流地址
    return this.getStreamUrls();
  }

  /**
   * 列出系统上可用的捕获设备（用于调试）
   */
  listCaptureDevices() {
    const ffmpegPath = systemUtils.checkFFmpeg();
    if (!ffmpegPath) return;

    try {
      if (process.platform === "darwin") {
        // 在macOS上列出avfoundation设备
        console.log("正在列出macOS上的avfoundation设备...");
        const result = execSync(
          `${ffmpegPath} -f avfoundation -list_devices true -i ""`,
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
        );
        console.log(result);
      } else if (process.platform === "win32") {
        // 在Windows上列出DirectShow设备
        console.log("正在列出Windows上的DirectShow设备...");
        const result = execSync(
          `${ffmpegPath} -list_devices true -f dshow -i dummy`,
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
        );
        console.log(result);
      } else {
        // 在Linux上列出v4l2设备
        console.log("正在列出Linux上的v4l2设备...");
        const result = execSync(`ls -la /dev/video*`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        console.log(result);
      }
    } catch (error) {
      // FFmpeg列出设备时通常会返回错误，但仍然会输出设备列表
      // 错误信息中通常包含设备列表
      if (error.stderr) {
        console.log("设备列表输出: ", error.stderr);
      }
      if (error.stdout) {
        console.log("设备列表输出: ", error.stdout);
      }
    }
  }

  /**
   * 开始捕获并推流
   * @param {Object} captureOptions 捕获选项
   * @returns {boolean} 是否成功开始捕获
   */
  startCapture(captureOptions = {}) {
    if (this.isCapturing) {
      console.log("已经在捕获中...");
      return false;
    }

    // 确保媒体服务器已初始化
    if (!this.nms) {
      console.log("媒体服务器未初始化，开始初始化");
      this.initMediaServer();
    }

    // 检查FFmpeg是否可用
    const ffmpegPath = systemUtils.checkFFmpeg();
    if (!ffmpegPath) {
      console.error("未找到FFmpeg，无法进行推流");
      if (dialog) {
        dialog.showMessageBoxSync({
          type: "error",
          title: "无法推流",
          message: "未找到FFmpeg，无法进行推流！请安装FFmpeg后重试。",
          buttons: ["确定"],
        });
      }
      return false;
    }

    try {
      console.log("捕获选项:", captureOptions);

      // 先列出可用的捕获设备，帮助诊断问题
      this.listCaptureDevices();

      console.log("开始屏幕捕获，流地址:", this.screenStreamUrl);

      // 在macOS上检查屏幕录制权限
      if (process.platform === "darwin") {
        try {
          // 尝试列出设备，这会触发权限请求
          execSync(`${ffmpegPath} -f avfoundation -list_devices true -i ""`, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          });
          console.log("已获得设备列表权限");
        } catch (error) {
          // 这个命令通常会返回错误，但如果包含"Permission denied"，表示没有权限
          if (error.stderr && error.stderr.includes("Permission denied")) {
            console.error("没有屏幕录制权限");
            if (dialog) {
              dialog.showMessageBoxSync({
                type: "error",
                title: "权限错误",
                message:
                  "没有屏幕录制权限。请在系统偏好设置中允许该应用录制屏幕。",
                buttons: ["确定"],
              });
            }
            return false;
          }
        }
      }

      // 先开始屏幕捕获推流（优先级高于摄像头）
      this.startScreenCapture();

      // 等待短暂时间确保屏幕捕获已经开始
      setTimeout(() => {
        // 再尝试开始摄像头捕获推流（如果屏幕捕获失败，可能会提前尝试启动）
        this.startCameraCapture();
      }, 1000);

      this.isCapturing = true;
      return true;
    } catch (error) {
      console.error("开始捕获时出错:", error);
      return false;
    }
  }

  /**
   * 开始屏幕捕获推流
   */
  startScreenCapture() {
    const ffmpegPath = systemUtils.checkFFmpeg();
    if (!ffmpegPath || !this.screenStreamUrl) {
      console.error("FFmpeg未找到或流URL为空");
      return;
    }

    console.log("准备开始屏幕捕获，使用FFmpeg:", ffmpegPath);

    // 根据操作系统构建不同的屏幕捕获命令
    let screenCommand = [];

    if (process.platform === "darwin") {
      // macOS系统下使用avfoundation捕获屏幕
      screenCommand = [
        "-f",
        "avfoundation",
        "-capture_cursor",
        "1", // 捕获鼠标
        "-capture_mouse_clicks",
        "1", // 捕获鼠标点击
        "-framerate",
        "30",
        "-i",
        "1:none", // 1是屏幕的默认设备索引，none表示不捕获音频
        "-vf",
        "scale=1280:720", // 缩放到720p以减轻负担
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-pix_fmt",
        "yuv420p", // 确保兼容性
        "-q:v",
        "28", // 降低质量以减少网络压力
        "-loglevel",
        "warning", // 只显示警告和错误信息，不输出帧质量
        "-f",
        "flv",
        this.screenStreamUrl,
      ];

      console.log("macOS屏幕捕获命令:", screenCommand.join(" "));
    } else if (process.platform === "win32") {
      // Windows系统下使用gdigrab捕获屏幕
      screenCommand = [
        "-f",
        "gdigrab",
        "-framerate",
        "30",
        "-i",
        "desktop",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-q:v",
        "28", // 降低质量以减少网络压力
        "-loglevel",
        "warning", // 只显示警告和错误信息，不输出帧质量
        "-f",
        "flv",
        this.screenStreamUrl,
      ];
    } else {
      // Linux系统下使用x11grab捕获屏幕
      screenCommand = [
        "-f",
        "x11grab",
        "-framerate",
        "30",
        "-video_size",
        "1920x1080",
        "-i",
        ":0.0",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-q:v",
        "28", // 降低质量以减少网络压力
        "-loglevel",
        "warning", // 只显示警告和错误信息，不输出帧质量
        "-f",
        "flv",
        this.screenStreamUrl,
      ];
    }

    // 启动屏幕推流进程并添加错误处理
    try {
      console.log(
        `开始运行FFmpeg进行屏幕捕获，完整命令: ${ffmpegPath} ${screenCommand.join(
          " "
        )}`
      );

      // 使用stdio: 'inherit'让错误输出显示在控制台，便于调试
      this.screenProcess = spawn(ffmpegPath, screenCommand, {
        stdio: ["ignore", "inherit", "inherit"],
        shell: true,
      });

      // 处理进程事件
      this.screenProcess.on("error", (error) => {
        console.error("屏幕推流进程错误:", error.message);
        this.screenProcess = null;
        // 尝试重新启动
        setTimeout(() => {
          if (!this.screenProcess && this.isCapturing) {
            console.log("尝试重新启动屏幕推流...");
            this.tryAlternativeScreenCapture();
          }
        }, 5000);
      });

      this.screenProcess.on("close", (code) => {
        console.log(`屏幕推流进程退出，代码: ${code}`);
        this.screenProcess = null;
        // 尝试重新启动
        if (code !== 0 && this.isCapturing) {
          setTimeout(() => {
            console.log("尝试重新启动屏幕推流...");
            this.tryAlternativeScreenCapture();
          }, 5000);
        }
      });
    } catch (error) {
      console.error("启动屏幕推流失败:", error.message);
      // 尝试备用方法
      this.tryAlternativeScreenCapture();
    }
  }

  /**
   * 尝试备用的屏幕捕获方法
   */
  tryAlternativeScreenCapture() {
    if (!this.ffmpegPath || !this.screenStreamUrl) {
      console.error("FFmpeg路径或流URL为空，无法尝试备用方法");
      return;
    }

    console.log("尝试备用的屏幕捕获方法...");

    // 在macOS上尝试一个更简单的命令行
    if (process.platform === "darwin") {
      const altCommand = [
        "-f",
        "avfoundation",
        "-i",
        "default:none", // 使用默认屏幕，不捕获音频
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-f",
        "flv",
        this.screenStreamUrl,
      ];

      console.log("macOS备用屏幕捕获命令:", altCommand.join(" "));

      try {
        this.screenProcess = spawn(this.ffmpegPath, altCommand, {
          stdio: ["ignore", "inherit", "inherit"],
          shell: true,
        });

        this.screenProcess.on("error", (error) => {
          console.error("备用屏幕捕获错误:", error.message);
          this.screenProcess = null;
        });

        this.screenProcess.on("close", (code) => {
          console.log(`备用屏幕捕获进程退出，代码: ${code}`);
          this.screenProcess = null;
        });
      } catch (error) {
        console.error("启动备用屏幕捕获失败:", error.message);
      }
    } else if (process.platform === "win32") {
      // Windows备用方法
      const altCommand = [
        "-f",
        "dshow",
        "-i",
        "video=screen-capture-recorder",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-f",
        "flv",
        this.screenStreamUrl,
      ];

      console.log("Windows备用屏幕捕获命令:", altCommand.join(" "));

      try {
        this.screenProcess = spawn(this.ffmpegPath, altCommand, {
          stdio: "pipe",
          shell: true,
        });

        this.screenProcess.stderr.on("data", (data) => {
          console.log(`备用捕获错误输出: ${data}`);
        });

        this.screenProcess.on("error", (error) => {
          console.error("备用屏幕捕获失败:", error.message);
        });

        this.screenProcess.on("close", (code) => {
          console.log(`备用屏幕捕获进程退出，代码: ${code}`);
          this.screenProcess = null;
        });
      } catch (error) {
        console.error("启动备用屏幕捕获失败:", error.message);
      }
    } else {
      // Linux备用方法
      const altCommand = [
        "-f",
        "x11grab",
        "-framerate",
        "15",
        "-video_size",
        "1280x720",
        "-i",
        ":0.0",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-f",
        "flv",
        this.screenStreamUrl,
      ];

      console.log("Linux备用屏幕捕获命令:", altCommand.join(" "));

      try {
        this.screenProcess = spawn(this.ffmpegPath, altCommand, {
          stdio: "pipe",
          shell: true,
        });

        this.screenProcess.stderr.on("data", (data) => {
          console.log(`备用捕获错误输出: ${data}`);
        });

        this.screenProcess.on("error", (error) => {
          console.error("备用屏幕捕获失败:", error.message);
        });

        this.screenProcess.on("close", (code) => {
          console.log(`备用屏幕捕获进程退出，代码: ${code}`);
          this.screenProcess = null;
        });
      } catch (error) {
        console.error("启动备用屏幕捕获失败:", error.message);
      }
    }
  }

  /**
   * 开始摄像头捕获推流
   */
  startCameraCapture() {
    const ffmpegPath = systemUtils.checkFFmpeg();
    if (!ffmpegPath || !this.cameraStreamUrl) {
      console.log("FFmpeg未找到或摄像头流URL为空，跳过摄像头捕获");
      return;
    }

    try {
      console.log("准备开始摄像头捕获，流地址:", this.cameraStreamUrl);

      // 根据操作系统构建不同的摄像头捕获命令
      let cameraCommand = [];

      if (process.platform === "darwin") {
        // macOS系统下使用avfoundation捕获摄像头
        cameraCommand = [
          "-f",
          "avfoundation",
          "-framerate",
          "30",
          "-video_size",
          "640x480",
          "-i",
          "0", // 0是FaceTime摄像头的默认设备索引
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-tune",
          "zerolatency",
          "-pix_fmt",
          "yuv420p", // 确保兼容性
          "-f",
          "flv",
          this.cameraStreamUrl,
        ];

        console.log("macOS摄像头捕获命令:", cameraCommand.join(" "));
      } else if (process.platform === "win32") {
        // Windows系统下使用dshow捕获摄像头
        cameraCommand = [
          "-f",
          "dshow",
          "-framerate",
          "30",
          "-video_size",
          "640x480",
          "-i",
          "video=Webcam", // 通常的摄像头名称，可能需要实际检测
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-tune",
          "zerolatency",
          "-pix_fmt",
          "yuv420p",
          "-f",
          "flv",
          this.cameraStreamUrl,
        ];
      } else {
        // Linux系统下使用v4l2捕获摄像头
        cameraCommand = [
          "-f",
          "v4l2",
          "-framerate",
          "30",
          "-video_size",
          "640x480",
          "-i",
          "/dev/video0",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-tune",
          "zerolatency",
          "-pix_fmt",
          "yuv420p",
          "-f",
          "flv",
          this.cameraStreamUrl,
        ];
      }

      // 启动摄像头推流进程
      console.log(
        `开始运行FFmpeg进行摄像头捕获，命令: ${ffmpegPath} ${cameraCommand.join(
          " "
        )}`
      );

      // 使用stdio: 'inherit'让错误输出显示在控制台，便于调试
      this.cameraProcess = spawn(ffmpegPath, cameraCommand, {
        stdio: ["ignore", "inherit", "inherit"],
        shell: true,
      });

      this.cameraProcess.on("error", (error) => {
        console.error("摄像头推流进程错误:", error.message);
        this.cameraProcess = null;
        // 摄像头错误不尝试重启，因为可能设备不存在
      });

      this.cameraProcess.on("close", (code) => {
        console.log(`摄像头推流进程退出，代码: ${code}`);
        this.cameraProcess = null;
      });
    } catch (error) {
      console.warn("摄像头捕获失败:", error.message);
      console.log(
        "摄像头捕获失败，这可能是正常的，如果设备没有摄像头或没有权限"
      );
    }
  }

  /**
   * 停止捕获
   */
  stopCapture() {
    this.stopScreenCapture();
    this.stopCameraCapture();
    this.isCapturing = false;
  }

  /**
   * 停止屏幕捕获
   */
  stopScreenCapture() {
    if (this.screenProcess) {
      // 在Windows上，使用taskkill强制终止进程
      if (process.platform === "win32") {
        try {
          execSync(`taskkill /pid ${this.screenProcess.pid} /f /t`);
        } catch (error) {
          console.error("停止屏幕推流进程时出错:", error);
        }
      } else {
        // 在其他平台上使用kill信号
        try {
          this.screenProcess.kill("SIGTERM");
        } catch (error) {
          console.error("停止屏幕推流进程时出错:", error);
        }
      }
      this.screenProcess = null;
    }
  }

  /**
   * 停止摄像头捕获
   */
  stopCameraCapture() {
    if (this.cameraProcess) {
      // 在Windows上，使用taskkill强制终止进程
      if (process.platform === "win32") {
        try {
          execSync(`taskkill /pid ${this.cameraProcess.pid} /f /t`);
        } catch (error) {
          console.error("停止摄像头推流进程时出错:", error);
        }
      } else {
        // 在其他平台上使用kill信号
        try {
          this.cameraProcess.kill("SIGTERM");
        } catch (error) {
          console.error("停止摄像头推流进程时出错:", error);
        }
      }
      this.cameraProcess = null;
    }
  }

  /**
   * 停止媒体服务器
   */
  stopMediaServer() {
    if (this.nms) {
      this.nms.stop();
      this.nms = null;
    }
  }

  /**
   * 获取当前的流地址
   * @returns {Object} 包含流地址的对象
   */
  getStreamUrls() {
    // 如果流密钥为空，说明媒体服务器尚未初始化
    if (!this.streamKey) {
      console.warn("尚未初始化媒体服务器，无法获取流地址");
      return {
        screenUrl: "",
        cameraUrl: "",
        streamKey: "",
      };
    }

    const localIp = systemUtils.getIpAddress();
    const { rtmpPort, httpPort } = this.config;

    // 替换localhost为本机IP
    const publicScreenUrl = this.screenStreamUrl
      ? this.screenStreamUrl.replace("localhost", localIp)
      : "";
    const publicCameraUrl = this.cameraStreamUrl
      ? this.cameraStreamUrl.replace("localhost", localIp)
      : "";

    // 构建完整的流地址对象
    const streamUrls = {
      screenUrl: publicScreenUrl,
      cameraUrl: publicCameraUrl,
      streamKey: this.streamKey,
      // 兼容旧代码的字段名
      rtmpUrl: publicScreenUrl,
      cameraRtmpUrl: publicCameraUrl,
    };

    // 如果FFmpeg可用，添加其他格式的流地址
    if (this.ffmpegPath) {
      streamUrls.httpFlvUrl = `http://${localIp}:${httpPort}/flv/${this.streamKey}.flv`;
      streamUrls.cameraFlvUrl = `http://${localIp}:${httpPort}/flv/camera_${this.streamKey}.flv`;
      streamUrls.hlsUrl = `http://${localIp}:${httpPort}/hls/${this.streamKey}.m3u8`;
      streamUrls.cameraHlsUrl = `http://${localIp}:${httpPort}/hls/camera_${this.streamKey}.m3u8`;
    }

    return streamUrls;
  }

  /**
   * 显示当前推流地址和状态
   */
  displayStreamInfo() {
    const streamUrls = this.getStreamUrls();
    console.log("\n========== 推流状态信息 ==========");
    console.log(
      `屏幕推流进程状态: ${this.screenProcess ? "运行中" : "未运行"}`
    );
    console.log(
      `摄像头推流进程状态: ${this.cameraProcess ? "运行中" : "未运行"}`
    );
    console.log(`屏幕推流地址: ${streamUrls.screenUrl}`);
    console.log(`摄像头推流地址: ${streamUrls.cameraUrl}`);

    // 显示如何在OBS中使用
    console.log("\n在OBS中使用这些流地址:");
    console.log("1. 添加 '媒体源'");
    console.log("2. 取消选中 '本地文件'");
    console.log("3. 将URL设置为上面的RTMP地址");
    console.log("4. 设置 '输入格式' 为 ffmpeg");
    console.log("========== 推流状态信息结束 ==========\n");

    return streamUrls;
  }
}

module.exports = new MediaService();
