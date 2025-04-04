package main

import (
	"fmt"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"exam-monitor-server/src/api"      // 使用正确的模块路径
	"exam-monitor-server/src/config"   // 使用正确的模块路径
	"exam-monitor-server/src/services" // 使用正确的模块路径
)

func main() {
	// 加载配置
	cfg := config.LoadConfig()

	// 初始化服务
	clientService := &services.ClientService{}
	wsService := services.NewWebSocketService() // 使用新的创建方法

	// 启动后台任务
	clientService.StartOfflineClientCleaner()

	// 初始化Gin引擎
	r := gin.Default()

	// 配置静态文件服务
	r.StaticFS("/static", http.Dir("./static")) // 确保路径正确
	// 首页路由
	r.GET("/", func(c *gin.Context) {
		c.File("./static/index.html") // 确保路径正确
	})

	// 注册API路由
	api.RegisterRoutes(r, cfg)

	// 处理WebSocket连接
	r.GET("/ws", api.HandleWebSocket(wsService))

	// 启动服务器
	addr := fmt.Sprintf(":%d", cfg.ServerPort)
	log.Printf("服务器启动，监听地址: %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("服务器启动失败: %v", err)
	}
} 