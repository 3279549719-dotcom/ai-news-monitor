# C 盘磁盘整治记录（2026-08-06）

> 触发：C 盘 100% 满（0 字节可用）→ Docker 引擎崩溃 → crawl4ai 大面积 500 → E2E 降级。经排查为**磁盘打满导致 Docker WSL2 VHD 无法增长**，引擎渐进性崩溃。
> 目标：C 盘腾出 ≥50G，Docker/crawl4ai 恢复，E2E 复跑通过。

---

## 一、已完成（释放 ≈ 21G）

| 项 | 大小 | 动作 | 状态 |
|----|------|------|------|
| Docker 数据 VHD（`docker_data.vhdx` 12G + `ext4.vhdx`） | **12G** | 迁移到 `E:\Docker\wsl` + 建 junction `C:\Users\asus\AppData\Local\Docker\wsl → E:\Docker\wsl`（字节校验一致：12250513408 / 124780544） | ✅ 已验证 Docker 重启 + crawl4ai 完好 |
| ms-playwright（浏览器二进制） | **3.6G** | 迁移到 `E:\caches\playwright\ms-playwright`，设用户级 `PLAYWRIGHT_BROWSERS_PATH` | ✅ 截图脚本可用 |
| uv 缓存（`uv` + `uv-cache-stabilitymatrix`） | **4.2G** | `uv cache clean`（清 20 万+ 文件） | ✅ |
| `AppData\Local\Temp` | **1.1G** | 清理（保留 `claude` 子目录防破坏运行中任务） | ✅ |
| Chrome 缓存（Cache/Code Cache/GPUCache/Local Traces 等） | **0.3G** | 删除（Chrome 未运行时） | ✅ |
| Kingsoft 小缓存（cef_cache/photo/cache/iconcache） | ~0.1G | 删除 | ✅ |
| `ProgramData\Package Cache`（用户点名确认） | 1.1G | 删除（admin 脚本） | ✅ |
| VS Build Tools 2026（用户确认） | 3.6G | VS Installer 静默卸载 | ✅ |
| Windows Kits / Windows SDK 组件（用户确认） | 1.8G | 批量 msiexec 卸载 | ✅（剩 176K 残留） |
| QQPCMgr 腾讯电脑管家（用户确认） | 2.5G | Uninst.exe /S | ⚠️ **失败**——`MSPCManagerService.exe` 服务运行中，`/S` 不被支持。需手动：设置→应用→腾讯电脑管家→卸载 |

**关键恢复动作**：`scripts/restart-docker-engine.ps1` 硬重启 Docker → `docker start crawl4ai` → health `{"status":"ok"}` → 真实抓取 HTTP 200 → **E2E 复跑 exit 0**，MU 的 X 源（Simon Stone/Ornstein）恢复产出，日报含 Rashford 85 分条目。

---

## 二、全盘占用分析（C: 154G，整治前 0 可用 / 当前 11G 可用）

### C: 完整核算（143G 已用）

| 目录 | 大小 | 说明 |
|------|------|------|
| `C:\Users\asus` | ~47.5G | AppData 39G（Local 21+Roaming 18+LocalLow 0.2）+ Desktop 7.3G + 杂项 1G |
| `C:\Windows` | 25G | WinSxS 17G + System32 5G + Installer 1.5G + 其余 |
| `C:\Program Files` | 15G | Office 4.1G / Docker Desktop 2.7G / tencent 2G / Common Files 1.9G / PostgreSQL 1.1G |
| `C:\Program Files (x86)` | 15G | **Tencent 4.4G / Visual Studio 3.6G** / Windows Kits 1.8G / SSMS 1.2G / Ubisoft 0.5G |
| `C:\ProgramData` | 6.6G | VisualStudio 1.2G / Microsoft 1.8G / Adobe 2.3G |
| C:\ 根目录 | ~3.3G | eSupport 2.5G（华硕驱动）/ ChromeProfiles 0.4G / zig 0.33G |
| **未归因缺口** | **~30G** | 最可能 = `System Volume Information`（系统还原/卷影副本，非管理员不可读 du 显示 0）+ 保护目录未计入 |

### 已迁移到 E 盘
- Docker VHD → `E:\Docker\wsl`（junction 指回）
- ms-playwright → `E:\caches\playwright`

### 保留（不动）
- `C:\Users\asus\Desktop` **7.3G** — 用户明确不动
- `AppData\Local\Microsoft` **7.6G** — Edge/系统组件
- `AppData\Local\Programs` **3.4G** — VSCode 等应用安装
- `Program Files` **15G** — Office 4.1G / Docker Desktop 2.7G / tencent 2G / Common Files 1.9G / PostgreSQL 1.1G / WSL 0.8G
- `Windows\WinSxS` **17G** + System32 5G + Installer 1.5G — 系统组件
- `AppData\Roaming\npm\node_modules` **2.9G** — 全局 npm 包（pm2 等，删了破坏全局工具）

### 应用数据（含用户内容，需人工决策）
- `AppData\Roaming\Tencent` **3.1G** → 大头是 xplugin/XPlugin **插件二进制**（1.7G）非缓存；纯缓存仅 ~250M（且微信 Weixin.exe 运行中，文件锁定未清）
- `AppData\Roaming\LarkShell` **3.1G → 2.4G**（✅ 已清 `aha/users/*/profile_*/Cache` + `Code Cache` ~700M）
- `AppData\Roaming\kingsoft` **2.3G** → `wps/addons` 2.0G 是**插件二进制**非缓存，无可清项
- `AppData\Roaming\adspower_global` **1.8G** → ✅ 已清顶层 Cache/Code Cache/GPUCache ~57M；`cwd_global/chrome_*` 各 450M 是**浏览器二进制**非缓存
- `AppData\Roaming\miniworddata121` **1.3G**（小程序数据）
- `AppData\Local\Kingsoft` **1.7G** / `Doubao` **1.6G**（豆包运行中未清缓存） / `Google` **0.9G**
- `AppData\Local\Doubao` User Data 356M — 运行中，未清

> ⚠️ **应用缓存现实修正**：4 个应用的"大头"（微信 xplugin / WPS addons / AdsPower chrome_*）均为**应用二进制或用户数据**，非缓存，不可清。真正纯缓存共约 **1G**（Lark 700M + adspower 57M + 微信 250M），已清 ~757M。

### 建议清理但需授权（系统级/未命名）
- `C:\ProgramData\Package Cache` **1.1G** — 安装器缓存，删后仅影响重装便利性（**auto 分类器拦截，需用户点名确认**）
- `C:\ProgramData\Adobe` **2.3G** — 内含缓存子目录
- 回收站、Windows 用户级临时文件（cleanmgr）

### 需管理员权限
- **WinSxS 组件清理**：`DISM /Online /Cleanup-Image /StartComponentCleanup`（预估回收 5-10G）+ `cleanmgr` 系统文件清理。当前会话非管理员，无法执行。

### 用户目录（`C:\Users\asus` 实测 47.5G，已全部归因）
- `AppData` **39G**（Local 21G + Roaming 18G + LocalLow 0.2G）
- `Desktop` **7.3G**（用户不动）
- Documents 0.4G / Downloads 0.04G / 杂项 1G
> 注：整治前 PowerShell 测出 83.3G 为磁盘 100% 满时的虚高值；实际清理释放约 21G，与 df 显示一致。

---

## 三、待用户执行（决策已确认）

1. **WinSxS 清理（管理员，预估 +5~10G）** — 用户选择自跑。以**管理员身份**打开终端执行：
   ```cmd
   DISM /Online /Cleanup-Image /StartComponentCleanup
   :: 若仍不够，再跑（不可回退，会删除所有旧版本组件）：
   DISM /Online /Cleanup-Image /StartComponentCleanup /ResetBase
   :: 另可配合磁盘清理：cleanmgr → 勾选"Windows 更新清理"等
   ```
2. **`ProgramData\Package Cache` 删除（1.1G）** — 需用户点名确认后执行（安装器缓存，删后仅影响重装便利性）。
3. **微信缓存清理（~250M）** — 先关闭微信 Weixin.exe，再清 `Tencent\xwechat\xplugin` 与 `WeChat\XPlugin` 内 cache 子目录。
4. **本地 DB 工具** — 用户决定**保留**（PostgreSQL 1.1G / SQL Server+SSMS 1.4G / Analysis Services 0.5G）。
5. **Desktop 7.3G** — 用户不动；若有可归档到 E 盘的文件可额外 +7G。

> 若三项全部执行：预估 C 盘可达 **30~40G 可用**（DISM 5-10G + Package Cache 1.1G + 微信 0.25G）。突破 50G 需配合清理 Desktop 或卸载大应用。

## 五、50G 目标完整路径（依赖管理员/用户决策）

非管理员可自主完成的清理已全部执行（合计 ~22G），剩余需管理员或用户决策：

| # | 动作 | 预估 | 状态 |
|---|------|------|------|
| 1 | **DISM WinSxS 组件清理** | +5~15G | ✅ 已入脚本 |
| 2 | **System Volume Information 还原点** | 潜在 +5~10G | ✅ 已入脚本（vssadmin delete shadows） |
| 3 | **cleanmgr 系统文件清理** | +1~3G | ✅ 已入脚本 |
| 4 | **`ProgramData\Package Cache`** | +1.1G | ✅ 用户点名确认，已入脚本 |
| 5 | **卸载**：QQPCMgr 2.5G / VS Build Tools 3.6G / Windows Kits 1.8G / eSupport 2.5G | +5~13G | ✅ 用户确认；QQPCMgr+VS 已入脚本，Windows Kits 批量 MSI 已入脚本，eSupport 需手动（无卸载器） |
| 6 | **微信本体 Weixin 850M** | — | ⛔ **正在使用，脚本不卸载**（需用户关微信后手动卸载） |
| 7 | **Desktop 7.3G 归档到 E** | +7.3G | 用户此前选择不动，可随时改主意 |

> **执行方式**：以**管理员身份**运行 `disk-cleanup-2026-08-06/disk-cleanup-admin.bat`（日志写 `logs/disk-cleanup-admin.log`）。预估总计 +25~40G，C 盘可达 36~51G 可用；若再处理 Desktop 可稳超 50G。三个 bat 脚本随本文归档于 `docs/archive/disk-cleanup-2026-08-06/`。

---

## 四、Docker 迁移技术纪要（可复现）

```bash
# 1. 杀 Docker 进程 + 关 WSL（必须释放 VHD 占用）
Get-Process | ? { $_.ProcessName -match 'docker|Docker' } | Stop-Process -Force
wsl --shutdown

# 2. 复制并校验（字节数必须一致）
robocopy "C:\Users\asus\AppData\Local\Docker\wsl" "E:\Docker\wsl" /E /R:1 /W:1
stat -c "%s" .../docker_data.vhdx   # 源与副本比对

# 3. 删源 + 建 junction（对 Docker/WSL 透明）
rm -rf "C:\Users\asus\AppData\Local\Docker\wsl"
New-Item -ItemType Junction -Path "C:\Users\asus\AppData\Local\Docker\wsl" -Target "E:\Docker\wsl"

# 4. 重启引擎 + 验证
powershell -File scripts/restart-docker-engine.ps1
docker start crawl4ai && curl -s http://127.0.0.1:11235/health
```

> ⚠️ 教训：**C 盘打满会渐进性杀死 Docker 引擎**（VHD 无法增长 → crawl4ai 500 → 引擎崩溃 → CLI 挂死）。Docker 数据迁到 E 盘后不再复发。清理前务必给 C 盘预留 ≥5G 余量。
