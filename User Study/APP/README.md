# Somatic City — iPhone 实验采集 App

用于城市步行实验的原生 iPhone App：连接 Polar H10，实时保存心率与逐搏 RR，计算滚动 RMSSD，记录 iPhone GPS，并手动标记实验阶段及事件。

## 打开与安装

1. 用 **Xcode 16 或更新版本**打开此目录的 `SomaticCity.xcodeproj`，选择 `SomaticCity` scheme。
2. 在 Signing & Capabilities 中选择你自己的开发团队（Personal Team 或开发者团队）；必要时把 Bundle Identifier 改成自己的唯一标识。
3. 连接 **iOS 17 或更新版本**的 iPhone，信任电脑，按系统要求启用开发者模式，选择这台 iPhone 后运行。
4. 安装到手机不等于发布到 App Store；本项目没有配置分发证书、开发者账号或 TestFlight。

工程只使用 Apple 的 SwiftUI、Core Bluetooth、Core Location 和 Foundation，没有第三方依赖、账号登录或服务器。

桌面图标与准备页使用 Somatic City 标志：薄荷绿定位轮廓中融入心率与城市形态。源图和生成提示词保存在 `Brand/`，iOS 图标已配置为 1024 × 1024 不透明 PNG。

## 一次实验怎么做

1. 佩戴并湿润 H10 电极，扣好传感器。准备页填写参与者**匿名编号**、批次、路线和方向。
2. 点击「开启蓝牙与定位」，允许蓝牙及使用期间的**精确位置**。从列表中选择自己的 Polar H10；如果设备正在被其他 App 占用，先断开其他 App 后再试。
3. 确认心率包、RR 间期和有效 GPS 都已到达。开始按钮要求最近 5 秒有心率和 RR，以及最近 15 秒内精度不差于 50 米的位置。
4. 点击「开始记录与静息基线」：创建独立场次，并立即保存 **A = 基线开始**。静息 5 分钟后点击 **B = 基线结束**。
5. 准备走路时点击 **C = 步行开始**。途中可点「进入商业段」「进入绿地段」「停留」「过街」「设备调整」「突发干扰」；点击即打标。自定义事件在按下「保存」时打标。
6. 步行完成点击 **D = 步行结束**，然后结束并保存本次记录。提前结束也保存数据，但场次标记为「已中断」。阶段按钮只允许 A→B→C→D，不能重复或跳过。
7. 在「实验记录」查看数量、事件和完成状态，打开一场实验，点击「导出全部到参与者文件夹」，在「文件」中选择保存位置。App 会新建以准备页所填参与者名称或匿名编号命名的文件夹，里面包含全部 13 个文件；同名已存在时自动附加本次实验的北京时间，再次冲突时加序号，始终不覆盖旧文件。也可选择「AirDrop / 分享全部文件压缩包」，一次发送一个 ZIP，解压得到参与者文件夹。
8. 删除历史实验时，在详情底部点击「删除本次实验记录」，或长按历史卡片选择「删除实验记录」，核对参与者及实验开始时间后确认。仅删除所选的一场实验及 App 内的导出缓存，已另存到「文件」或传出的副本会保留。进行中的实验不可删除。

手机时间/时区在开始时记入场次。**页面时钟、事件时间线和实验开始/结束时间固定显示北京时间（Asia/Shanghai，当前 UTC+08:00），格式为 `2026-10-17 18:23:45.327`，末尾三位为毫秒。**录制期间不要修改系统时区或时钟；检测到明显时钟跳变会写诊断记录。时长取进程内的单调计时，原始绝对时间另行保留。

参与者模式会隐藏记录页的心率、HRV 数值，采集保持进行。原实验方案要求避免给参与者展示生理信号，建议正式测试开启此模式。

## 页面和功能

| 页面 | 功能 |
|---|---|
| 准备 | 匿名编号、B1/B2/B3、路线、方向、蓝牙搜索/连接、权限和信号就绪检查、演示开关、参与者模式 |
| 记录 | 实验计时、阶段打标、心率、60 秒 RMSSD、定位精度和坐标、已落盘数量、快捷事件、自定义备注、结束保存 |
| 实验记录 | 已完成/中断/进行中场次、设备与时区、信号数量、事件时间线、参与者文件夹导出、ZIP 分享、确认后删除单场历史记录 |

## 演示模式

准备页打开「使用演示数据」，即可不连接胸带测试记录、HRV 暖机、阶段、事件、保存和分享。也可以在 Xcode scheme 的 Run → Arguments 启用 `--demo`。

**演示心率与轨迹由程序生成。**页面有橙色标记，场次 metadata 的 `source` 为 `demo`，GPS 来源同样为 `demo`，不能作为实验数据。录制中不能切换来源或更换设备。

## 数据文件

每次实验使用 UUID 作为独立目录，保存在 App 的 `Documents/StudySessions/` 中。可通过 iPhone「文件」App 或 Finder 的文件共享访问。未手动导出时不会上传任何数据。卸载 App 会清除本地数据。

导出副本在 `StudySessions/Exports/场次 UUID/参与者名称/` 内生成，不改变原始记录目录。同一参与者的不同场次分别保存；文件夹名称保留中文，斜杠、换行等不适合文件名的字符会替换为下划线。ZIP 名称为 `参与者名称_实验开始北京时间.zip`，压缩包和直接保存的文件夹包含相同的 13 个文件。

| 导出文件 | 内容 |
|---|---|
| `heart_rate_raw.csv` | 心率、接触状态、接收时间、数据包 ID、RR 数量和原始蓝牙数据十六进制 |
| `rr_raw.csv` | 每个 RR 的原始值、接收时间、包内次序、相对于包末的偏移、有效标记与排除原因 |
| `hrv.csv` | 每次更新的 RMSSD、60 秒窗口、有效比例、有效心跳/相邻对数量、状态与算法版本 |
| `gps_raw.csv` | 定位采样时间、手机接收时间、坐标、海拔、速度、精度、来源和可用性 |
| `events.csv` | 事件 UTC 时间、经过秒数、代码、名称、备注；关联定位的采样时间、年龄和精度 |
| `diagnostics.csv` | 蓝牙状态、断连重连、定位错误、前后台变化、时钟跳变等 |
| `marks.csv` | 当前 Web 平台兼容格式；`备注` 列为 A/B/C/D 或 EVENT 等代码，文字说明另列 |
| `rr.csv` | 当前 Web 平台兼容格式：`timestamp,rr_ms`，仅包含通过启发式筛选的 RR |
| `hr.csv` | 当前 Web 平台兼容格式：Date / Start time 元信息，加 Time / HR (bpm) 样本 |
| `route.gpx` | 可用定位点及 UTC 采样时间；超过 30 秒缺口或无效点会分轨迹段 |
| `metadata.json` | 参与者编号、设备、来源、方向、批次、起止、状态、时区和算法配置 |
| `records.jsonl` | 按到达顺序追加的完整原始记录；JSON 时间以 Unix 毫秒保存 |
| `README.txt` | 本次导出的数据语义和分析注意事项 |

原始 CSV 同时提供 UTC ISO 8601、明确的**北京时间**（列名以 `beijing` 标识）、Unix 毫秒整数（列名以 `unix_ms` 标识）和单调经过秒数。GPS 同时提供定位采样时间与手机接收时间；事件另存关联 GPS 的采样时间，三者不会混用。`marks.csv` 另加「北京时间」和 `unix_ms` 列。

CSV 为带 UTF-8 BOM 的标准逗号分隔文件，备注中的逗号、引号和换行正确转义。`marks.csv` 的「展示时间」、`rr.csv` 与 `hr.csv` 的兼容时间仍采用**实验开始时记录的手机时区**，不改变原有 Web 对齐规则；北京时间附加列始终固定为 Asia/Shanghai。

从格式 v2 开始，每条原始 JSONL 记录落盘时也保存 `timestampBeijing` 和 `timestampUnixMilliseconds`，定位点保存 `sampledAtBeijing` 与 `sampledUnixMilliseconds`。已有 v1 记录仍能读取，并在重新导出时自动得到北京时间列。毫秒是时间记录的分辨率，并不表示 GPS 每毫秒采样，也不代表所有传感器有毫秒级同步精度。

### 接入现有 Web 平台

推荐使用 [Merge V2](https://murmur0725.github.io/physiogeo-merge-tool/v2/)：上传本 App 导出的完整 ZIP 和独立设备的 EEG 文件（CSV、XLSX 或 XLS）。V2 会直接读取 ZIP 内的原始数据与事件，按 A→B 切分基线、C→D 切分实验，生成与 V1 相同列格式的秒级 CSV。EEG 仍需独立设备同步采集；本 App 不采集 EEG 或 EDA。Merge 与 Review 使用相同的 Subjector ID，以便关联生理数据和问卷。

V2 使用原始 UTC / Unix 毫秒和 metadata 中的场次时区，不依赖导入电脑的时区。EEG 没有 UTC 偏移的时间须在页面上选择其来源时区；仍需核对两台设备的时钟。V2 只按秒平均有效 RR，不填补生理数据缺口；GPS 使用最近收到的可用位置，最多保留 15 秒。原始 ZIP、EEG 和合并结果保存到现有 Supabase 私有后端。

[Merge V1](https://murmur0725.github.io/physiogeo-merge-tool/v1/) 保留原来的五文件导入：`marks.csv`、`rr.csv`、EEG Excel、`route.gpx`、`hr.csv`。V1 的兼容 CSV 按电脑本地时间解析，GPX 从 UTC 转为电脑本地时间，Route timezone 只用于 EEG 换算，所以使用 V1 时电脑系统时区应与实验时区一致。V1 会对 RR 向前补齐，并对 GPS 插值。

两个版本的秒级合并文件均不能代替原始逐搏数据计算 HRV。HRV 分析应使用 `rr_raw.csv` 和质量信息，原始定位有效性以 `gps_raw.csv` 为准。

## HRV 和时间语义

- 通过 H10 支持的**标准 Bluetooth Heart Rate Service**直接读取心率和 RR，没有引入 Polar SDK。当前需求不包含 ECG、设备内离线录制或固件管理；若将来需要这些功能，可再接入 Polar 官方 SDK。
- 蓝牙 RR 的原始单位为 1/1024 秒，解析后换算为毫秒。一包可能包含多个 RR，全部分别保存。
- 标准心率数据包没有逐搏的绝对采样时间。本 App 记录的是**手机收到包的时间**，加包内 RR 顺序和相对偏移；相对偏移不能消除蓝牙传输延迟，也不是经验证的 R 峰 UTC 时间。不能把所有信号宣称为毫秒级硬件同步。
- RMSSD 使用过去 60 秒窗口，仅对原始相邻且都有效的 RR 对求差，不跨异常值拼接。筛选规则为 RR 300–2000 ms、相对上一个原始 RR 变化不超过 20%；需要至少 30 个有效 RR、20 对有效相邻 RR，以及至少 80% 有效比例。原始异常值仍保存。
- 断连、蓝牙状态异常、接触丢失或 RR 接收间隔超过 5 秒后重新积累窗口。没有新 RR 时不会显示旧 HRV 为实时值。心率超过 5 秒无新包时隐藏实时数值。
- 这些是透明且可调整的**探索性规则**，不是经验证的临床伪迹校正算法。步行数据应离线核查，保留并报告排除比例；不同窗口长度和筛选规则不能混用后直接比较。
- 定位保留自己的采样时间，不能用回调时间替代。事件只关联最近 15 秒的可用位置，保留该位置年龄；没有新定位时事件坐标留空，不伪造新位置。

## 连续采集和恢复

- 工程已配置 `bluetooth-central` 和 `location` 后台模式；真实采集开始后开启后台定位及系统定位指示器，结束后停止定位。
- 蓝牙断连会记录事件并尝试重连；Apple 的蓝牙状态恢复也已实现。重连后继续同一场实验，但 HRV 重新暖机；设备身份不会在录制中切换。
- 每个接收到的数据包/定位/事件都会追加写入 JSONL 并同步到本地文件。界面保存数量在写入成功后才增加；写入失败会停止记录并提示。
- 应用异常退出或被系统终止后，下次启动会把未结束场次标为「已中断」，不会假装中间一直在采集，也不会自动续录。仅忽略末尾未完整提交的一行；中间记录损坏会明确报错。
- 数据文件使用首次解锁后可访问的文件保护，支持开始实验后的锁屏写入。不能保证用户强制退出、设备重启、系统终止或权限被撤销后继续采集。

## 验证

2026-10-17 本机验证：初版 iPhone 真机目标和 iOS Simulator 目标均完成无签名 Debug 构建；初版已通过 Xcode 安装并启动到连接的 iPhone。北京时间更新的 18 项核心自动化测试全部通过，包括跨日期/时区的毫秒转换、GPS 采样与接收时间区分、旧格式兼容。尚未完成真实 H10 对照采集和锁屏持续采集验收，不能据编译/启动结果认定数据质量与后台稳定性已验证。

可在此目录运行：

```sh
swift test
xcodebuild -project SomaticCity.xcodeproj -scheme SomaticCity \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/SomaticCityDerivedData CODE_SIGNING_ALLOWED=NO build
```

核心测试覆盖多 RR/16 位心率/能量字段/截断包解析、RR 单位换算、已知 RMSSD、异常对不拼接、暖机及 RR 中断、接触丢失、Unicode CSV 转义、JSONL 和毫秒时间往返、异常退出恢复、尾部部分写入、导出及 A→B→C→D 阶段约束。

2026-10-17 文件管理更新已通过全部 23 项核心测试，另覆盖中文及特殊名称、重复导出不覆盖、13 个文件逐字节比对、ZIP 解压还原、单场删除隔离，以及拒绝删除进行中的场次；iPhone 目标已编译通过。手机上的「文件」选择器和 AirDrop 传输仍需真机操作验收。

**尚需真机验收，未宣称完成真实设备验证：**

1. 对照另一份 H10 记录检查 5 分钟静息心率、RR 总数和逐搏值。
2. 完整走一次实验路线，检查各文件、四个阶段标记、事件和 GPS 缺失。
3. 锁屏及切到相机/其他 App 后继续走 15–30 分钟，检查原始记录间隔。
4. 测试胸带脱离、蓝牙关闭、超出距离、重连；检查日志与 HRV 重置。
5. 测试定位权限拒绝、精度不足、录制中撤销权限及 App 强制退出恢复。
6. 导出到「文件」和 AirDrop，再导入当前 Web 页，核对基线与步行边界和时区。

## 实现参考

- [Bluetooth SIG Heart Rate Service](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/HRS_v1.0/out/en/index-en.html)
- [Apple Core Bluetooth 后台处理与恢复](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html)
- [Apple 后台定位](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background)
- [Apple 文件夹访问](https://developer.apple.com/documentation/uikit/providing-access-to-directories)
- [Apple 文件夹 ZIP 快照](https://developer.apple.com/documentation/foundation/nsfilecoordinator/readingoptions/foruploading)
- [Polar 官方 SDK（未来扩展）](https://github.com/polarofficial/polar-ble-sdk)
- [Polar 时间机制](https://github.com/polarofficial/polar-ble-sdk/blob/master/documentation/TimeSystemExplained.md)
