# 小艺插件补丁备份

## 文件列表
- `xy-parser.js` — 提取 deviceId（多用户隔离）
- `xy-bot.js` — 多用户隔离 + 图片设备隔离
- `file-download.js` — 图片按 deviceId 分目录下载
- `SOUL.md` — 设备隔离的 agent 指令

## 恢复命令
```bash
PLUGIN_DIR=$(ls -d ~/.openclaw/npm/projects/ynhcj-xiaoyi-*/node_modules/@ynhcj/xiaoyi/dist/ | head -1)
cp ~/xiaoyi-plugin-patches/xy-parser.js $PLUGIN_DIR/
cp ~/xiaoyi-plugin-patches/xy-bot.js $PLUGIN_DIR/
cp ~/xiaoyi-plugin-patches/file-download.js $PLUGIN_DIR/
cp ~/xiaoyi-plugin-patches/SOUL.md ~/.openclaw/workspace/
openclaw gateway restart
```

## 改动说明（V3 - 2026-07-18）
1. **多用户隔离**: peerId 改用 deviceId，每设备独立 session
2. **记忆隔离**: devices/<deviceId>/USER.md MEMORY.md，全局文件 chmod 444 硬保护
3. **图片隔离**: media/xy_channel/<deviceId>/ 每设备独立图片目录
4. **图片识别**: imageModel → openrouter/qwen/qwen2.5-vl-72b-instruct

## OpenClaw 配置
```bash
agents.defaults.model.primary = deepseek/deepseek-v4-flash
agents.defaults.imageModel = openrouter/qwen/qwen2.5-vl-72b-instruct
models.providers.openrouter.apiKey = sk-or-v1-...
agents.defaults.maxConcurrent = 20
session.dmScope = per-channel-peer
```
