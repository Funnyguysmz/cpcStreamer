package api

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"exam-monitor-server/src/config"   // 使用正确的模块路径
	"exam-monitor-server/src/models"   // 使用正确的模块路径
	"exam-monitor-server/src/services" // 使用正确的模块路径
)

// 认证中间件
func AuthMiddleware(cfg *config.AppConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 方法1: 查询参数验证 (适用于GET请求)
		if password := c.Query("password"); password == cfg.DefaultPassword {
			c.Next()
			return
		}

		// 方法2: 从头信息验证 (适用于所有请求)
		if password := c.GetHeader("X-Auth-Password"); password == cfg.DefaultPassword {
			c.Next()
			return
		}

		// 请求体验证在各处理函数中单独处理，避免消费请求体
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"status": "error", "message": "未提供有效的密码"})
	}
}

// 注册API路由
func RegisterRoutes(r *gin.Engine, cfg *config.AppConfig) {
	clientService := &services.ClientService{}
	streamService := &services.StreamService{}
	notificationService := &services.NotificationService{}
	obsService := &services.ObsService{}

	// API分组
	api := r.Group("/api")

	// 管理员控制台访问的API不需要认证
	api.GET("/clients", HandleGetClients(clientService))
	api.GET("/notifications", HandleGetNotifications(notificationService))
	api.POST("/select-stream", HandleSelectStream(streamService))
	api.GET("/selected-stream", HandleGetSelectedStream(streamService))
	api.POST("/set-output-url", HandleSetOutputUrl(cfg))
	api.GET("/output-url", HandleGetOutputUrl(cfg))
	api.POST("/send-notification", HandleSendNotification(notificationService))
	api.GET("/obs/config", HandleGetObsConfig(obsService))
	api.POST("/obs/config", HandleSetObsConfig(obsService))

	// 客户端访问的API
	api.POST("/report-stream", HandleReportStream(clientService))
	api.POST("/report-system-info", HandleReportSystemInfo(clientService))
	// 修改为 GET 请求，并通过查询参数认证
	api.GET("/client-notifications", HandleClientNotifications(notificationService))

	// 健康检查接口
	api.GET("/health-check", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "success", "message": "服务器运行正常"})
	})
}

// 处理客户端报告流地址
func HandleReportStream(service *services.ClientService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.StreamRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"status": "error", "message": "请求格式错误: " + err.Error()})
			return
		}

		// 验证请求体内的密码
		if req.Password != config.GetConfig().DefaultPassword {
			return
		}

		service.UpdateClient(&req)
		c.JSON(http.StatusOK, gin.H{"status": "success", "message": "流地址已更新"})
	}
}

// 处理客户端报告系统信息
func HandleReportSystemInfo(service *services.ClientService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.SystemInfoReport
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"status": "error", "message": "请求格式错误: " + err.Error()})
			return
		}

		// 验证请求体内的密码
		if req.Password != config.GetConfig().DefaultPassword {
			c.JSON(http.StatusUnauthorized, gin.H{"status": "error", "message": "密码错误"})
			return
		}

		if err := service.UpdateSystemInfo(&req); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"status": "error", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "success", "message": "系统信息已更新"})
	}
}

// 处理获取所有客户端信息
func HandleGetClients(service *services.ClientService) gin.HandlerFunc {
	return func(c *gin.Context) {
		clients := service.GetAllClients()
		c.JSON(http.StatusOK, gin.H{"status": "success", "data": clients})
	}
}

// 处理选择流
func HandleSelectStream(service *services.StreamService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.SelectStreamRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"status": "error", "message": "请求格式错误: " + err.Error()})
			return
		}

		client, err := service.SelectStream(req.MachineNumber)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"status": "error", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"status":  "success",
			"message": "已选择新的流",
			"data": map[string]interface{}{ // 返回流地址
				"screenUrl": client.RtmpUrl,
				"cameraUrl": client.CameraUrl,
			},
		})
	}
}

// 处理获取当前选中的流
func HandleGetSelectedStream(service *services.StreamService) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := service.GetSelectedStream()
		if client == nil {
			c.JSON(http.StatusOK, gin.H{"status": "success", "data": nil, "message": "当前没有选中的流"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"status": "success",
			"data": map[string]interface{}{ // 返回流地址
				"machineNumber": client.MachineNumber,
				"screenUrl":     client.RtmpUrl,
				"cameraUrl":     client.CameraUrl,
			},
		})
	}
}

// 处理设置输出流地址
func HandleSetOutputUrl(cfg *config.AppConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.SetOutputUrlRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"status": "error", "message": "请求格式错误: " + err.Error()})
			return
		}
		cfg.OutputURL = req.OutputUrl // 直接修改配置实例（非持久化）
		log.Printf("默认输出流地址已更新为: %s", cfg.OutputURL)
		c.JSON(http.StatusOK, gin.H{"status": "success", "message": "输出流地址已更新"})
	}
}

// 处理获取输出流地址
func HandleGetOutputUrl(cfg *config.AppConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "success", "data": cfg.OutputURL})
	}
}

// 处理发送通知
func HandleSendNotification(service *services.NotificationService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.SendNotificationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"status": "error", "message": "请求格式错误: " + err.Error()})
			return
		}
		service.SendNotification(&req)
		c.JSON(http.StatusOK, gin.H{"status": "success", "message": "通知已发送"})
	}
}

// 处理获取通知历史
func HandleGetNotifications(service *services.NotificationService) gin.HandlerFunc {
	return func(c *gin.Context) {
		notifications := service.GetNotifications()
		c.JSON(http.StatusOK, gin.H{"status": "success", "data": notifications})
	}
}

// 处理设置OBS配置
func HandleSetObsConfig(service *services.ObsService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.ObsConfigRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"status": "error", "message": "请求格式错误: " + err.Error()})
			return
		}
		service.SetObsConfig(req)
		c.JSON(http.StatusOK, gin.H{"status": "success", "message": "OBS配置已更新"})
	}
}

// 处理获取OBS配置
func HandleGetObsConfig(service *services.ObsService) gin.HandlerFunc {
	return func(c *gin.Context) {
		config := service.GetObsConfig()
		c.JSON(http.StatusOK, gin.H{"status": "success", "data": config})
	}
}

// 处理WebSocket连接
func HandleWebSocket(wsService *services.WebSocketService) gin.HandlerFunc {
	return func(c *gin.Context) {
		conn, err := services.WsUpgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Printf("WebSocket升级失败: %v", err)
			return
		}
		defer conn.Close()

		wsService.AddWsClient(conn)
		defer wsService.RemoveWsClient(conn)

		// 保持连接打开，处理传入消息（如果需要）
		for {
			// 读取消息 (当前仅保持连接，不处理客户端消息)
			_, _, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("WebSocket错误: %v", err)
				}
				break // 客户端断开连接
			}
			// 可在此处添加处理客户端发送的消息的逻辑
		}
	}
}

// 处理客户端GET请求获取通知 (修改为GET，从Query参数获取)
func HandleClientNotifications(service *services.NotificationService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 从查询参数获取 machineNumber 和 password
		machineNumber := c.Query("machineNumber")
		password := c.Query("password")

		if machineNumber == "" {
			c.JSON(http.StatusBadRequest, gin.H{"status": "error", "message": "缺少 machineNumber 查询参数"})
			return
		}

		// 验证查询参数中的密码
		if password != config.GetConfig().DefaultPassword {
			c.JSON(http.StatusUnauthorized, gin.H{"status": "error", "message": "密码错误"})
			return
		}

		// 获取指定客户端的通知
		notifications := service.GetNotificationsForClient(machineNumber)
		c.JSON(http.StatusOK, gin.H{"status": "success", "data": notifications})
	}
}
