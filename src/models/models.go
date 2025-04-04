package models

import "time"

// SysInfo 定义系统信息
type SysInfo struct {
	MacAddress string `json:"macAddress"` // MAC地址
	IPAddress  string `json:"ipAddress"`  // IP地址
	HostName   string `json:"hostName"`   // 主机名
	Platform   string `json:"platform"`   // 平台
	OSVersion  string `json:"osVersion"`  // 系统版本
	Arch       string `json:"arch"`       // 架构
	CpuInfo    string `json:"cpuInfo"`    // CPU型号
	MemoryTotal string `json:"memoryTotal"` // 总内存
	MemoryFree string `json:"memoryFree"`  // 可用内存
}

// Student 定义考生信息
type Student struct {
	StudentId   string `json:"studentId"`   // 学号
	StudentName string `json:"studentName"` // 姓名
}

// ClientInfo 定义考生客户端信息
type ClientInfo struct {
	MachineNumber string    `json:"machineNumber"` // 考试机号
	StreamKey     string    `json:"streamKey"`     // 流密钥
	RtmpUrl       string    `json:"rtmpUrl"`       // 屏幕RTMP流地址
	CameraUrl     string    `json:"cameraUrl"`     // 摄像头RTMP流地址
	SystemInfo    SysInfo   `json:"systemInfo"`    // 系统信息
	StudentInfo   Student   `json:"studentInfo"`   // 考生信息
	LastUpdate    time.Time `json:"lastUpdate"`    // 最后更新时间
	IsOnline      bool      `json:"isOnline"`      // 是否在线
}

// StreamRequest 定义接收流请求的结构体
type StreamRequest struct {
	MachineNumber string    `json:"machineNumber"` // 考试机号
	StreamKey     string    `json:"streamKey"`     // 流密钥
	RtmpUrl       string    `json:"rtmpUrl"`       // RTMP流地址
	CameraUrl     string    `json:"cameraUrl"`     // 摄像头RTMP流地址
	Password      string    `json:"password"`      // 密码
	SystemInfo    SysInfo   `json:"systemInfo"`    // 系统信息
	StudentInfo   Student   `json:"studentInfo"`   // 考生信息
}

// SystemInfoReport 定义系统信息报告的结构体
type SystemInfoReport struct {
	MachineNumber string  `json:"machineNumber"` // 考试机号
	Password      string  `json:"password"`      // 密码
	SystemInfo    SysInfo `json:"systemInfo"`    // 系统信息
}

// Notification 定义消息通知
type Notification struct {
	MachineNumber string `json:"machineNumber"` // 目标机器号 ("*" 表示所有)
	Message       string `json:"message"`       // 消息内容
	Level         string `json:"level"`         // 消息级别(info, warning, error)
	Timestamp     time.Time `json:"timestamp"`    // 时间戳
}

// SelectStreamRequest 定义选择流请求
type SelectStreamRequest struct {
	MachineNumber string `json:"machineNumber"` // 考试机号
	Password      string `json:"password"`      // 密码
}

// SetOutputUrlRequest 定义设置输出URL请求
type SetOutputUrlRequest struct {
	OutputUrl string `json:"outputUrl"` // 输出URL
	Password  string `json:"password"`  // 密码
}

// SendNotificationRequest 定义发送通知请求
type SendNotificationRequest struct {
	MachineNumber string `json:"machineNumber"` // 目标机器号 ("*" 表示所有)
	Message       string `json:"message"`       // 消息内容
	Level         string `json:"level"`         // 消息级别(info, warning, error)
	Password      string `json:"password"`      // 密码
}

// ObsConfigRequest 定义OBS配置请求
type ObsConfigRequest struct {
	Enabled      bool   `json:"enabled"`
	WebSocketUrl string `json:"webSocketUrl"`
	Password     string `json:"password"`      // OBS密码
	AdminPassword string `json:"adminPassword"` // 管理员密码
}

// ClientNotificationRequest 客户端获取通知请求
type ClientNotificationRequest struct {
	MachineNumber string `json:"machineNumber"`
	Password      string `json:"password"`
} 