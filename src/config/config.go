package config

import (
	"encoding/json"
	"log"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"sync"
)

// ObsConfig OBS配置
type ObsConfig struct {
	Enabled      bool   `json:"enabled"`       // 是否启用OBS集成
	WebSocketUrl string `json:"webSocketUrl"`  // OBS WebSocket地址
	Password     string `json:"password"`      // OBS WebSocket密码
}

// AppConfig 应用配置
type AppConfig struct {
	ServerPort      int       `json:"serverPort"`      // 服务器端口
	DefaultPassword string    `json:"defaultPassword"` // 默认密码
	OutputURL       string    `json:"outputUrl"`       // 输出流地址
	Obs             ObsConfig `json:"obs"`             // OBS配置
}

var (
	config     *AppConfig // 全局配置实例
	configLock sync.Mutex // 配置锁
)

// 获取可用端口
func getAvailablePort(startPort int) int {
	port := startPort
	for {
		ln, err := net.Listen("tcp", ":"+strconv.Itoa(port))
		if err != nil {
			log.Printf("端口 %d 已被占用，尝试下一个端口", port)
			port++
			continue
		}
		ln.Close()
		return port
	}
}

// LoadConfig 加载配置
func LoadConfig() *AppConfig {
	configLock.Lock()
	defer configLock.Unlock()

	if config != nil {
		return config
	}

	// 默认配置
	config = &AppConfig{
		ServerPort:      8080,
		DefaultPassword: "admin123",
		OutputURL:       "rtmp://localhost:1935/live/output",
		Obs: ObsConfig{
			Enabled:      false,
			WebSocketUrl: "ws://localhost:4455",
			Password:     "",
		},
	}

	// 尝试从配置文件加载
	configDir := "./config"
	if _, err := os.Stat(configDir); os.IsNotExist(err) {
		os.MkdirAll(configDir, 0755)
	}

	configFile := filepath.Join(configDir, "config.json")
	if _, err := os.Stat(configFile); os.IsNotExist(err) {
		// 配置文件不存在，创建默认配置
		data, _ := json.MarshalIndent(config, "", "  ")
		os.WriteFile(configFile, data, 0644)
	} else {
		// 配置文件存在，加载配置
		data, err := os.ReadFile(configFile)
		if err == nil {
			if err = json.Unmarshal(data, config); err != nil {
				log.Printf("解析配置文件失败: %v，将使用默认配置", err)
			}
		} else {
			log.Printf("读取配置文件失败: %v，将使用默认配置", err)
		}
	}

	// 检查端口是否可用，如果不可用则尝试其他端口
	port := getAvailablePort(config.ServerPort)
	if port != config.ServerPort {
		log.Printf("端口 %d 已被占用，将使用端口 %d", config.ServerPort, port)
		config.ServerPort = port
	}

	log.Printf("已加载配置，服务器将在端口 %d 上运行", config.ServerPort)
	return config
}

// GetConfig 获取配置
func GetConfig() *AppConfig {
	if config == nil {
		return LoadConfig()
	}
	return config
}

// SaveConfig 保存配置
func SaveConfig() error {
	configLock.Lock()
	defer configLock.Unlock()

	if config == nil {
		return nil
	}

	configDir := "./config"
	if _, err := os.Stat(configDir); os.IsNotExist(err) {
		os.MkdirAll(configDir, 0755)
	}

	configFile := filepath.Join(configDir, "config.json")
	data, _ := json.MarshalIndent(config, "", "  ")
	return os.WriteFile(configFile, data, 0644)
}

// SetObsConfig 设置OBS配置
func SetObsConfig(obsConfig ObsConfig) {
	config.Obs = obsConfig
}

// getEnv 获取环境变量或返回默认值
func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}

// getEnvAsBool 获取布尔类型的环境变量
func getEnvAsBool(key string, defaultValue bool) bool {
	valueStr := getEnv(key, "")
	if valueStr == "" {
		return defaultValue
	}
	value, err := strconv.ParseBool(valueStr)
	if err != nil {
		log.Printf("无效的布尔值 '%s' 用于键 '%s'，使用默认值 %t", valueStr, key, defaultValue)
		return defaultValue
	}
	return value
} 