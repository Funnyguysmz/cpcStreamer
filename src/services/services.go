package services

import (
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"exam-monitor-server/src/config" // 使用正确的模块路径
	"exam-monitor-server/src/models" // 使用正确的模块路径
)

// ServerState 定义服务器状态
type ServerState struct {
	mu             sync.Mutex
	clients        map[string]*models.ClientInfo // 客户端信息，key为机器号
	selectedStream string                      // 当前选中的流（机器号）
	wsClients      map[*websocket.Conn]bool    // WebSocket客户端集合
	notifications  []models.Notification       // 通知历史
}

var (
	state = ServerState{
		clients:   make(map[string]*models.ClientInfo),
		wsClients: make(map[*websocket.Conn]bool),
	}
)

// WsUpgrader WebSocket升级器配置
var WsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // 允许所有来源的WebSocket连接
	},
}

// ClientService 客户端服务
type ClientService struct {}

// UpdateClient 更新客户端信息
func (s *ClientService) UpdateClient(req *models.StreamRequest) {
	state.mu.Lock()
	defer state.mu.Unlock()

	clientInfo := &models.ClientInfo{
		MachineNumber: req.MachineNumber,
		StreamKey:     req.StreamKey,
		RtmpUrl:       req.RtmpUrl,
		CameraUrl:     req.CameraUrl,
		SystemInfo:    req.SystemInfo,
		StudentInfo:   req.StudentInfo,
		LastUpdate:    time.Now(),
		IsOnline:      true,
	}

	state.clients[req.MachineNumber] = clientInfo

	// 如果之前没有选中流，自动选择第一个在线的流
	if state.selectedStream == "" {
		state.selectedStream = req.MachineNumber
		broadcastToWebSocket(map[string]interface{}{ // 使用内部函数
			"type": "stream_selection_change",
			"data": map[string]interface{}{ // 发送完整信息
				"machineNumber": req.MachineNumber,
				"screenUrl":    req.RtmpUrl,
				"cameraUrl":    req.CameraUrl,
			},
		})
	}

	broadcastToWebSocket(map[string]interface{}{ // 使用内部函数
		"type": "clients_update",
	})
}

// UpdateSystemInfo 更新客户端系统信息
func (s *ClientService) UpdateSystemInfo(req *models.SystemInfoReport) error {
	state.mu.Lock()
	defer state.mu.Unlock()

	client, exists := state.clients[req.MachineNumber]
	if !exists {
		return fmt.Errorf("客户端 %s 不存在", req.MachineNumber)
	}

	client.SystemInfo = req.SystemInfo
	client.LastUpdate = time.Now()
	client.IsOnline = true

	broadcastToWebSocket(map[string]interface{}{ // 使用内部函数
		"type": "clients_update",
	})
	return nil
}

// GetAllClients 获取所有客户端信息
func (s *ClientService) GetAllClients() []*models.ClientInfo {
	state.mu.Lock()
	defer state.mu.Unlock()

	var clientList []*models.ClientInfo
	for _, client := range state.clients {
		clientList = append(clientList, client)
	}
	return clientList
}

// StartOfflineClientCleaner 启动定时清理离线客户端的协程
func (s *ClientService) StartOfflineClientCleaner() {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			s.cleanOfflineClients()
		}
	}()
}

// cleanOfflineClients 标记离线客户端
func (s *ClientService) cleanOfflineClients() {
	state.mu.Lock()
	defer state.mu.Unlock()

	now := time.Now()
	needsBroadcast := false
	for id, client := range state.clients {
		// 60秒没有更新的客户端标记为离线
		if client.IsOnline && now.Sub(client.LastUpdate) > 60*time.Second {
			client.IsOnline = false
			log.Printf("客户端 %s 标记为离线", id)
			needsBroadcast = true

			// 如果当前选中的流是这个离线的客户端，清除选择
			if state.selectedStream == id {
				state.selectedStream = ""
				// 稍后统一广播
			}
		}
	}

	if needsBroadcast {
		// 广播客户端列表更新
		broadcastToWebSocket(map[string]interface{}{ // 使用内部函数
			"type": "clients_update",
		})
		// 如果选中的流被清空，广播选流变更
		if state.selectedStream == "" {
			broadcastToWebSocket(map[string]interface{}{ // 使用内部函数
				"type": "stream_selection_change",
				"data": nil, // 发送 null 表示没有选中
			})
		}
	}
}

// StreamService 流服务
type StreamService struct {}

// SelectStream 选择要显示的流
func (s *StreamService) SelectStream(machineNumber string) (*models.ClientInfo, error) {
	state.mu.Lock()
	defer state.mu.Unlock()

	client, exists := state.clients[machineNumber]
	if !exists || !client.IsOnline {
		return nil, fmt.Errorf("客户端 %s 不存在或不在线", machineNumber)
	}

	state.selectedStream = machineNumber

	// 广播选流变更
	broadcastToWebSocket(map[string]interface{}{ // 使用内部函数
		"type": "stream_selection_change",
		"data": map[string]interface{}{ // 发送完整信息
			"machineNumber": client.MachineNumber,
			"screenUrl":    client.RtmpUrl,
			"cameraUrl":    client.CameraUrl,
		},
	})

	// 尝试切换OBS场景
	go func(mn string) {
		obsService := &ObsService{}
		if err := obsService.SwitchScene(fmt.Sprintf("考生_%s", mn)); err != nil {
			log.Printf("警告：切换OBS场景失败: %v", err)
		}
	}(machineNumber)

	return client, nil
}

// GetSelectedStream 获取当前选中的流
func (s *StreamService) GetSelectedStream() *models.ClientInfo {
	state.mu.Lock()
	defer state.mu.Unlock()

	if state.selectedStream == "" {
		return nil
	}
	client, exists := state.clients[state.selectedStream]
	if !exists || !client.IsOnline {
		state.selectedStream = "" // 如果选中的客户端已离线，清空选择
		return nil
	}
	return client
}

// NotificationService 通知服务
type NotificationService struct {}

// SendNotification 发送通知
func (s *NotificationService) SendNotification(req *models.SendNotificationRequest) {
	state.mu.Lock()
	defer state.mu.Unlock()

	notification := models.Notification{
		MachineNumber: req.MachineNumber,
		Message:       req.Message,
		Level:         req.Level,
		Timestamp:     time.Now(),
	}
	state.notifications = append(state.notifications, notification)

	// 限制通知历史数量（例如，保留最新的100条）
	if len(state.notifications) > 100 {
		state.notifications = state.notifications[len(state.notifications)-100:]
	}

	// 如果目标是所有客户端 ("*") 或特定客户端
	if req.MachineNumber == "*" {
		broadcastToWebSocket(map[string]interface{}{ // 使用内部函数
			"type": "notification",
			"data": notification,
		})
	} else {
		// 查找特定客户端的WebSocket连接并发送
		// 注意：这里假设客户端在 WebSocket 连接时会发送机器号以进行识别
		// 当前实现没有直接通过机器号查找 WebSocket 连接的功能，需要改进
		log.Printf("向特定客户端发送通知的功能待实现，广播给所有客户端: %+v", notification)
		broadcastToWebSocket(map[string]interface{}{ // 使用内部函数
			"type": "notification",
			"data": notification,
		})
	}
}

// GetNotifications 获取所有通知
func (s *NotificationService) GetNotifications() []models.Notification {
	state.mu.Lock()
	defer state.mu.Unlock()
	// 返回通知副本，避免外部修改
	notificationsCopy := make([]models.Notification, len(state.notifications))
	copy(notificationsCopy, state.notifications)
	return notificationsCopy
}

// GetNotificationsForClient 获取特定客户端的通知
func (s *NotificationService) GetNotificationsForClient(machineNumber string) []models.Notification {
	state.mu.Lock()
	defer state.mu.Unlock()

	// 如果没有指定机器号，返回所有通知
	if machineNumber == "" {
		notificationsCopy := make([]models.Notification, len(state.notifications))
		copy(notificationsCopy, state.notifications)
		return notificationsCopy
	}

	// 否则过滤出适用于该客户端的通知
	result := make([]models.Notification, 0)
	for _, notification := range state.notifications {
		// 通知是发给所有人的，或者是发给这个特定客户端的
		if notification.MachineNumber == "" || notification.MachineNumber == "*" || notification.MachineNumber == machineNumber {
			result = append(result, notification)
		}
	}
	return result
}

// WebSocketService WebSocket服务
type WebSocketService struct {
	streamService *StreamService // 添加StreamService引用
}

// NewWebSocketService 创建新的WebSocketService实例
func NewWebSocketService() *WebSocketService {
	return &WebSocketService{
		streamService: &StreamService{},
	}
}

// AddWsClient 添加WebSocket客户端
func (s *WebSocketService) AddWsClient(conn *websocket.Conn) {
	state.mu.Lock()
	state.wsClients[conn] = true
	state.mu.Unlock()
	log.Println("新的WebSocket客户端连接")

	// 发送初始状态信息给新连接的客户端
	s.sendInitialState(conn)
}

// RemoveWsClient 移除WebSocket客户端
func (s *WebSocketService) RemoveWsClient(conn *websocket.Conn) {
	state.mu.Lock()
	delete(state.wsClients, conn)
	state.mu.Unlock()
	log.Println("WebSocket客户端断开连接")
}

// sendInitialState 发送初始状态给新连接的WebSocket客户端
func (s *WebSocketService) sendInitialState(conn *websocket.Conn) {
	state.mu.Lock()
	// 准备客户端列表
	var clientList []*models.ClientInfo
	for _, client := range state.clients {
		clientList = append(clientList, client)
	}
	// 获取选中的流信息
	selectedClient := s.streamService.GetSelectedStream() // 使用streamService的方法
	state.mu.Unlock()

	// 发送客户端列表
	if err := conn.WriteJSON(map[string]interface{}{ // 使用 WriteJSON
		"type": "initial_clients",
		"data": clientList,
	}); err != nil {
		log.Printf("发送初始客户端列表失败: %v", err)
	}

	// 发送当前选中的流
	selectedStreamData := make(map[string]interface{})
	if selectedClient != nil {
		selectedStreamData["machineNumber"] = selectedClient.MachineNumber
		selectedStreamData["screenUrl"] = selectedClient.RtmpUrl
		selectedStreamData["cameraUrl"] = selectedClient.CameraUrl
	}
	if err := conn.WriteJSON(map[string]interface{}{ // 使用 WriteJSON
		"type": "initial_selection",
		"data": selectedStreamData,
	}); err != nil {
		log.Printf("发送初始选中流失败: %v", err)
	}
}

// broadcastToWebSocket 广播消息给所有WebSocket客户端 (内部函数)
func broadcastToWebSocket(message interface{}) {
	state.mu.Lock()
	defer state.mu.Unlock()

	for conn := range state.wsClients {
		err := conn.WriteJSON(message)
		if err != nil {
			log.Printf("错误：发送WebSocket消息失败: %v", err)
			conn.Close()
			delete(state.wsClients, conn)
		}
	}
}

// ObsService OBS服务
type ObsService struct {}

// SwitchScene 切换OBS场景
func (s *ObsService) SwitchScene(sceneName string) error {
	cfg := config.GetConfig()
	if !cfg.Obs.Enabled {
		return fmt.Errorf("OBS集成未启用")
	}

	log.Printf("尝试切换OBS场景到: %s", sceneName)

	// 连接OBS WebSocket
	conn, _, err := websocket.DefaultDialer.Dial(cfg.Obs.WebSocketUrl, nil)
	if err != nil {
		return fmt.Errorf("连接OBS WebSocket失败: %v", err)
	}
	defer conn.Close()

	// 发送认证请求 (如果需要密码)
	if cfg.Obs.Password != "" {
		authRequest := map[string]interface{}{
			"op": 1,
			"d": map[string]interface{}{
				"rpcVersion":     1,
				"authentication": base64.StdEncoding.EncodeToString([]byte(cfg.Obs.Password)),
			},
		}
		if err := conn.WriteJSON(authRequest); err != nil {
			return fmt.Errorf("发送OBS认证请求失败: %v", err)
		}
		// 读取认证响应 (忽略内容)
		var authResponse map[string]interface{}
		if err := conn.ReadJSON(&authResponse); err != nil {
			return fmt.Errorf("读取OBS认证响应失败: %v", err)
		}
		// 检查认证是否成功 (根据OBS WebSocket协议)
		// ...
	}

	// 发送场景切换请求
	sceneRequest := map[string]interface{}{
		"op": 6,
		"d": map[string]interface{}{
			"requestType": "SetCurrentProgramScene", // 使用 SetCurrentProgramScene 切换主场景
			"requestId":   "switch-scene-" + sceneName,
			"requestData": map[string]interface{}{
				"sceneName": sceneName,
			},
		},
	}

	if err := conn.WriteJSON(sceneRequest); err != nil {
		return fmt.Errorf("发送OBS场景切换请求失败: %v", err)
	}

	// 读取切换响应 (忽略内容)
	var sceneResponse map[string]interface{}
	if err := conn.ReadJSON(&sceneResponse); err != nil {
		// OBS WebSocket在成功切换后可能不返回特定响应，或者返回不同op code
		// 这里打印日志而不是返回错误，除非明确知道有错误响应
		log.Printf("读取OBS场景切换响应时出错(可能不是错误): %v, 响应: %+v", err, sceneResponse)
	}

	log.Printf("OBS场景切换请求已发送至: %s", sceneName)
	return nil
}

// SetObsConfig 设置OBS配置
func (s *ObsService) SetObsConfig(req models.ObsConfigRequest) {
	cfg := config.GetConfig()
	newObsConfig := config.ObsConfig{
		Enabled:      req.Enabled,
		WebSocketUrl: req.WebSocketUrl,
		Password:     req.Password,
	}
	cfg.Obs = newObsConfig
	log.Printf("OBS配置已更新: %+v", newObsConfig)
}

// GetObsConfig 获取OBS配置
func (s *ObsService) GetObsConfig() config.ObsConfig {
	return config.GetConfig().Obs
} 