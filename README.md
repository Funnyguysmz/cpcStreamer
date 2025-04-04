# 考试监控系统 - 服务端

这是考试监控系统的服务端部分，用于接收客户端推送的流媒体，管理考生在线状态，以及提供监考员控制界面。

## 功能特性

- 接收并管理客户端推送的 RTMP 流地址
- 提供 Web 界面，允许监考员查看和选择不同考生的流
- 将选中的流提供给 OBS 等接收端
- 支持向考生发送通知消息
- 实时更新考生在线状态
- WebSocket 实时通信

## 技术栈

- Go 语言
- Gin Web 框架
- WebSocket 实时通信
- 前端：HTML, CSS, JavaScript (原生)

## 快速开始

### 前提条件

- 安装 Go (1.16+)
- 安装 FFmpeg (用于客户端推流，非服务端必需)

### 安装与运行

1. 克隆代码库

   ```bash
   git clone https://github.com/your-repo/exam-monitor-server.git
   cd exam-monitor-server
   ```

2. 安装依赖

   ```bash
   go mod tidy
   ```

3. 运行服务器

   ```bash
   go run main.go
   ```

4. 访问监考员控制台
   ```
   http://localhost:8080
   ```

## 配置说明

服务器默认配置：

- 监听端口：8080
- 默认管理员密码：admin123

## API 接口说明

### 流相关接口

- `POST /api/report-stream`：客户端报告流地址
- `GET /api/clients`：获取所有客户端信息
- `POST /api/select-stream`：选择流
- `GET /api/selected-stream`：获取当前选中的流
- `POST /api/set-output-url`：设置输出流地址
- `GET /api/output-url`：获取输出流地址

### 系统信息接口

- `POST /api/report-system-info`：客户端报告系统信息

### 通知相关接口

- `POST /api/send-notification`：发送通知给特定客户端
- `GET /api/notifications`：获取通知历史

## 客户端集成

客户端需要定期向服务器发送以下信息：

1. 流地址：使用`/api/report-stream`接口
2. 系统信息：使用`/api/report-system-info`接口

客户端应定期检查`/api/notifications`接口以获取通知消息。

## 监考员使用说明

1. 打开监考员控制台 (http://localhost:8080)
2. 查看左侧在线考生列表
3. 点击考生项目选择要查看的流
4. 使用 OBS 等工具连接到控制面板中显示的"输出流地址"
5. 使用"发送通知"功能向考生发送消息

## 开发人员说明

### 核心数据结构

- `ClientInfo`：考生客户端信息
- `StreamRequest`：接收流请求
- `Notification`：消息通知
- `ServerState`：服务器状态

### WebSocket 事件

- `init`：初始状态
- `clients_update`：客户端列表更新
- `stream_selection_change`：选中的流变更
- `output_url_change`：输出 URL 变更
- `notification`：新通知

## 许可证

MIT
