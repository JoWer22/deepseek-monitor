# 🔍 DeepSeek API 余额监控（浏览器插件）
#### 自己用AI捣鼓出来的小玩意，继续 维护ing。
![插件截图](assets/screenshot.png)

## 版本说明 (Changelog)
## v2.0
🎉 稳定版本V2.0发布
- 实时显示 DeepSek API 余额。
- 添加解密失败的重试机制，提升插件的稳定性。
- 支持从本地存储解密并加载 API Key，确保安全性和兼容性。
- 保持 Service Worker 活跃的机制优化，避免插件在后台被意外终止。
- 优化日志输出，便于调试和问题排查。

## 📦 发布版本（Releases）
👉 [releases--V2.0](https://github.com/JoWer22/deepseek-monitor/releases)

## 🚀 安装方法
1. **下载 ZIP**（点右边 `↓ Code` → `Download ZIP`）
2. 解压文件
3. 浏览器打开 `chrome://extensions`
4. 开启 **"开发者模式"**
5. 点击 **"加载已解压的扩展程序"**，选择解压的文件夹

## 🛠️ 开发
```bash
git clone https://github.com/JoWer22/deepseek-monitor.git
cd deepseek-monitor
