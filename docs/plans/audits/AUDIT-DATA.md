# AUDIT-DATA — Worker 2 Phase-0 audit report (as delivered)

Provenance: chat session wfx-a2-data (GLM-5.3 + Full-Stack, agents tab), dispatched by TL2 2026-10-09, base SHA 7a14bc9b24a1ac6f1b30c9a55efcdfaf4b8f9286. Harvested verbatim from the session transcript (extract_full.py, 2026-10-09 16:56 UTC). Original language retained (Chinese); source citations are path:line references into the pinned tree. TL2 review notes follow at the bottom.

---

执行摘要与关键决策建议

#
	
发现
	
建议(TL2 冻结)

1	tasks-index.sqlite 的「sha256 迁移账本 + worker 线程启动 + zod 帧校验」是仓内最成熟的持久化模板	直接作为本地库(local-library)蓝本，不另起炉灶
2	凭证加密密钥存在确定性弱回退(zcode-credential-fallback:{platform}:{homedir}:{username}),无 OS keychain/safeStorage	Phase 1 前替换为 OS vault 后端密钥
3	数据根存在三向分歧(见 §2.4)	WebFlix 必须使用独立数据根，禁止继承 ~/.zcode
4	无任何备份/导出/恢复机制，违反 data-ownership.md:44	「最小可行本地库」必须带 backup/export + 测试过的 restore
5	无任何包声明 test 脚本；hermetic 测试仅能手工调用	Phase 1 前定义一等测试命令

2. 交付物 1:存储实现与用点清单

2.1 tasks-index.sqlite(node:sqlite,DatabaseSync)— 主库

实现:packages/services/src/session/tasksDatabase/{startup,migrations,schema-v1,prepared}.ts + session/taskIndexRepo.ts、automationRepo.ts、offPeakTaskRepo.ts
启动序列(startup.ts:31-124 prepareTasksIndexStorage):mkdir → new DatabaseSync(path) → busy_timeout=25、foreign_keys=ON(:44-45)→ 锁感知 acquire("PRAGMA journal_mode = WAL") + synchronous=NORMAL(:70-71)→ 只读预检 inspectTasksMigrationKind(:73)→ BEGIN IMMEDIATE(:76)→ 迁移 → 先报事实再 close(:78-97,close 失败不覆盖首因)→ markTasksStorageMigrated(:98)→ 三 Repo ensureReady()(:99-107)→ markTasksStoragePrepared(:122)→ ready(:123)
锁等待预算:LOCK_WAIT_MS = 60min(:28);SQLITE_BUSY(errcode & 0xff === 5)以 100ms 退避重试至 deadline,超时抛 lock_timeout(:50-68)
迁移账本(migrations.ts:46-211):3 条冻结定义(0001_adopt_task_schema / 0002_provider_selection / 0003_official_glm_selection,:46-67);账本表 tasks_schema_migration(id PK, checksum, time_applied)(:86-88);每条 sha256(JSON.stringify(checksumInput))(:98-100);checksum 不匹配 → checksum_mismatch 硬失败(:105-109、:175-179、:198-201);rollback 吞错保首因(:127-137);areTasksDatabaseMigrationsApplied(:160-181)与只读预检 inspectTasksMigrationKind(:184-211,返回 none/upgrade/initialize)防「替换文件假 ready」
运行时 Repo:taskIndexRepo.ts PRAGMA :527-530(busy_timeout=启动预算/foreign_keys/WAL/synchronous=NORMAL);writeChains per-key 写串行化(:489、:666-675);13 处 BEGIN IMMEDIATE(:632、:787、:847、:934、:1077、:1312、:1497、:1540、:1581、:2007、:2453 等)
桌面用点:desktop/src/host/hostDatabaseStartup.ts:47(取路径)、host/tasksStorageWorker.ts:15(worker 线程内执行 prepare)、host/index.ts、scheduler/index.ts + scheduler/offPeakDispatchSettlement.ts(三 Repo 消费)、main/index.ts:1942 + main/desktopDataBaseDirBootstrap.ts:44(setDataBaseDir)
路径:paths.ts:185-188 → ~/.zcode/v2/tasks-index.sqlite

2.2 CLI session DB(嵌套 workspace,被 desktop 拉起)

apps/zcode-cli/packages/adapters/src/storage/session-store/{sqlite-session-store,migration-runner,migrations}.ts;路径 paths.ts:6-8 → ~/.zcode/cli/db/db.sqlite;SQLITE_MIGRATIONS 恰 22 条(0001_base_session_store … 0022_backfilled_session_reasoning,逐一计数验证)

2.3 JSON 持久化(~/.zcode/v2)

setting.json:settingService.ts:59-60;损坏隔离备份 + 短重试防误清(:73-89、:126-130);settingsWriteQueue 代际合并写(:242-264)
credentials.json:credentialService.ts:32;原子写(:78)+ 解密读(:101)/加密写(:107)+ 文件锁(:111、:122)
基础设施:shared/src/node/privateFilePersistence.ts — withFileLock(:51)、atomicWritePrivateTextFile(0600,:88/:100)、backupCorruptFile(.corrupt-{id}.bak,wx 独占,:108-120)

2.4 数据根分歧(重要)

paths.ts:33-40:setDataBaseDir() > ZCODE_DATA_BASE_DIR > 模块加载时缓存的 homedir(防实例漂移)
settingService.ts:48-51:ZCODE_DESKTOP_HOME_DIR > HOME > USERPROFILE(动态读)
CLI:裸 homedir()
数据目录迁移:copyDataDirectory(paths.ts:231-255,排除 setting.json 及其瞬态兄弟文件与符号链接)

3. 交付物 2:现有契约/入口模式

复用(REUSE):

ServiceDescriptor/ServiceChannels(services/src/descriptors.ts:8-16):以 channelName 标识服务 + phantom type 关联类型，渲染桥与 main 共用
Managed module 结构模板(architecture-policy.yaml:26-33 声明的 storage 模块):contract.ts(唯一公开入口，IStorageService contract.ts:31)+ domain/{cleanPlan,storageCatalog,usageAggregate} + app/{ports,scanJob,storageService} + adapters/{fsWalker,fsCleaner,rootsResolver,volumeProbe,inProcessScanRunner};数据类型唯一事实源在 @zcode/shared(contract.ts:8-25 再导出)
zod .strict() + 错误码分类 + 进程边界脱敏:shared/src/database-startup.ts(errorCodeSchema :3-17、classifyDatabaseStartupError :20、databaseStartupErrorDetails 脱敏 :44);worker 帧 zod 校验(validation.ts:472、:987)
worker 线程 + zod 帧边界:tasksStorageWorker 模式(prepare 在 worker、状态/控制帧经 shared schema)
IPlatformService(shared/src/platform.ts:529)、StorageManagementApi(shared/src/storage.ts:133)

替换(REPLACE):

storage 服务已不再注册为 host RPC 服务(contract.ts:28-30 注释：desktop main 持有单实例，资源管理器窗口专用)——WebFlix 本地库若需多窗口/渲染层访问，不能照抄此「单实例直持」形态，应走 ServiceDescriptor 注册路径
session 模块的 publicEntrypoints: [session/contract.ts](policy :20-25)是 legacy(managed: false)先例；新模块必须 managed: true 且声明 layers/layerOrder/owner(全局约束：maxFileLines 400、maxContractLines 300、maxPublicMethods 12、forbidCycles、forbidDeepImports,policy :59-66)

4. 交付物 3:凭证/秘密/Profile 边界

算法：AES-256-GCM,前缀 enc:v1:,12B IV,16B authTag(credentialCipherProvider.ts:5-8)
密钥缺陷(高危):deriveCipherKey(defaultCredentialSecret(env))(:56-60)——密钥 = sha256(ZCODE_CREDENTIAL_SECRET 或确定性回退 zcode-credential-fallback:{platform}:{homedir}:{username},:24-38)。无随机盐、无 OS keychain、无 Electron safeStorage;已知用户名/家目录即可跨机器推导密钥。必须替换
明文透传：decrypt 无前缀直接返回原文(:80-82)——兼容旧数据，但意味着明文凭证仍可入文件
OAuth 模型：单活跃 provider(ACTIVE_PROVIDER_KEY = "oauth:active_provider" :13;oauth:{provider}:access_token/refresh_token/user_info :24-34;共享 zcodejwttoken :15);损坏密文 → 强制登出 + 派生 provider 清理回调(:432-447),且不误删 SSH 等独立凭据
Profile 边界：不存在。单一 credentials.json + 单一 setting.json,无多 Profile 隔离；data-ownership.md:29-30 要求「本地 profile 不共享库状态、每 provider 账号稳定内部 ID + 隔离凭证域」——当前实现不满足；:34「不得自动继承 ZCode session」、:20「凭证永不明文同步/不暴露给 renderer」为硬边界
chromeCookieManager(desktop main)属 Audit A 范围，此处仅记录边界重叠

5. 交付物 4:最小可行本地库 + 数据归属图

提案：单一 webflix.db(node:sqlite)

完整镜像 tasks 模式：sha256 迁移账本 + 只读预检 + BEGIN IMMEDIATE + WAL + worker 线程启动 + zod 帧校验 + 锁超时预算
表分两类(data-ownership.md:41「durable 用户状态与 regenerable 缓存/索引分离」)：
durable:library entries、collections、notes、pinned、local playlists、watched state、resume points
regenerable:provider metadata 投影、文件索引、扫描缓存(可删重建，:42「索引存路径/指纹/元数据，不拷贝媒体字节」)
必须内建(当前仓内缺失，:44 未满足)：backup/export + 测试过的 restore;恢复路径覆盖缺文件/坏索引/失败迁移且不静默丢数据(:43)
数据归属映射(直接采自 data-ownership.md:9-25):
库条目/收藏/笔记/置顶/本地播放列表 → WebFlix,profile/device,local-only(:12)
播放续播点/已看状态 → WebFlix,与 provider 历史分离，local-only(:13)
本地文件路径/指纹/索引 → 本地设备，默认不同步绝对路径(:16)
torrent 任务/peer 状态/目标路径 → 本地引擎，local-only(:17)
字幕/翻译/配音/摘要/embedding → WebFlix 派生物，默认不上云，需权利/同意(:18)
凭证/token → credential adapter/OS vault,永不入 renderer(:20)
诊断日志 → local,默认脱敏(:25)

6. 交付物 5:包根/契约/依赖方向提案


```
packages/webflix-contracts     # zod schema + 类型 + channels(替代 ad-hoc shared 再导出)
packages/webflix-domain         # 库域逻辑(纯函数,零 IO)
packages/webflix-application    # 用例 + ports(依赖倒置接口)
packages/local-library          # adapters:sqlite repo、迁移账本、backup/export
```

依赖方向(单向):local-library → application → domain → contracts;desktop/ui 只依赖 contracts + application;forbidDeepImports + forbidCycles 已是全局 policy(:63-64)
每个新模块按 storage 模板在 architecture-policy.yaml 注册:managed: true + publicEntrypoints: [<pkg>/src/contract.ts] + layers/layerOrder/owner(仿 :26-33);契约文件受 maxContractLines: 300 约束(:61)
@zcode/shared 保留为宿主(ZCode)基础设施;WebFlix 数据类型不再写入 shared,避免宿主/产品耦合

7. 交付物 6:实际跑过的 hermetic 测试与门禁(全部本回合实跑，exit code 如实)

命令
	
结果
	
EXIT

git rev-parse HEAD / git status --short	7a14bc9b…286 / 空(跑前跑后各验一次)	0
node scripts/check-workspace-freshness.mjs	基线新鲜，0 阈值违规	0
pnpm architecture:report	violations / baselineViolations / newViolations 均 []	0
pnpm typecheck	tsc -b 全部 11 个项目无错	0
pnpm lint	70 warnings / 0 errors,2616 files,565ms	0
node --import tsx --test test/*.test.ts(cwd=packages/services)	10/10 pass(importedClaudeRecovery 2 + providerConfigMigration 4 + nonCliAcpRetirement 4)	0
node --import tsx --test test/*.test.ts(cwd=packages/ui)	6/6 pass	0
node --import tsx --test packages/ui/test/…(cwd=仓库根)	ERR_MODULE_NOT_FOUND: Cannot find package '@/lib' → 1 fail	(见注)

合计 hermetic:16 pass / 0 fail(正确调用方式下)
如实记录：ui 测试从仓库根调用失败(tsx 从根不解析 packages/ui tsconfig 路径别名)——调用上下文工件，非代码缺陷；从 packages/ui cwd 调用即全绿
无任何 package.json 声明 test 脚本(root 与各包均无)，hermetic 套件只能手工发现调用 —— 本身即一条测试基建发现
测试隔离模式：mkdtemp 临时目录 + setDataBaseDir 注入(见 services 测试)，可被 Phase 1 直接继承

8. 未决问题(交 TL2 裁决，含 UNKNOWN)

数据根命名：WebFlix 独立根(如 ~/.webflix)vs 沿用 ~/.zcode 分区？三向分歧(§2.4)必须先收敛
凭证 vault:OS keychain / Electron safeStorage 选型;enc:v1: 旧密文迁移策略
UNKNOWN — Electron 内 node:sqlite 可用性：dev 环境 Node v24.21.0 正常，但 Electron 自带 Node 运行时;createRequire("node:sqlite") 规避了打包器改写(startup.ts:4-8)却未在打包后 Electron 验证——Phase 1 前必须实测，否则本地库技术选型不成立
单库 webflix.db vs 多库：本报告建议单库 + 表分类，待冻结
Profile 模型：多 Profile 隔离(data-ownership.md:29-30)与现有单用户凭证/设置文件的差距如何分期
契约版本化：zod schema 跨 renderer/main 版本演进策略(帧内版本字段?)
一等测试命令：root pnpm test 或逐包 test 脚本 + 修复 ui 根调用工件——Phase 1 前定义

9. 风险声明与信息来源

风险分级：① 确定性凭证回退密钥(高，§4)② 无 backup/restore 违反 data-ownership.md:44(高，§5)③ 数据根三向分歧 → 跨实例误写(中)④ Electron 内 node:sqlite UNKNOWN(阻塞级，§8.3)⑤ 无 test 脚本 → 回归不可见(中)
合规声明：本审计严格只读——未编辑任何文件、未 commit/branch/push,所有命令跑完后 git status --short 仍为空；未发现真实凭证/秘密外泄(仅引用代码常量)；测试均在 mkdtemp 隔离目录；环境失败(ui 根调用工件)已如实记录为调用上下文问题而非代码缺陷。
信息来源(pinned tree 直读):AGENTS.md、architecture-policy.yaml(:26-33、:59-66)、docs/architecture/architecture-lock.md、docs/architecture/data-ownership.md(:9-45)、docs/plans/{worker-protocol,desktop-roadmap,tl2-handoff,work-claims}.md、docs/testing/desktop-acceptance.md、docs/operations/local-development.md、packages/services/src/{paths.ts,session/tasksDatabase/*,session/{taskIndexRepo,automationRepo,offPeakTaskRepo}.ts,storage/*,setting/*,credential/*,oauth/repo/oauthCredentialRepo.ts}、packages/shared/src/{platform,storage,database-startup,validation,zcode-protocol}.ts、packages/shared/src/node/privateFilePersistence.ts、packages/services/src/descriptors.ts、packages/rpc/src/index.ts、packages/desktop/src/{host/*,scheduler/*,main/*}、apps/zcode-cli/packages/adapters/src/storage/session-store/*。

收到。AUDIT-DATA 审计在本会话已完成全部取证与复核；按任务要求「最终报告须为最后一条消息并以 AUDIT-DATA COMPLETE
