# 预约删除实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 executing-plans 逐任务实现此计划。步骤使用复选框跟踪进度。

**目标：** 为已打开但未运行的归档会话提供持久化预约删除，并在下次 DSH 初始化时自动安全删除。

**架构：** 静态 Host 行提供 `sessionArchiverPending` 服务，使用 `~/.dsh/session-archiver/pending-delete.json` 原子持久化标记，并在创建动态 handler 前处理标记。动态 Host handler 只调用该服务安排/取消预约和读取分流结果；静态 Client UI 增加“预约删除”Tab。

**技术栈：** Node.js ESM、Cordis Host/Client Plugin、React.createElement、node:test-compatible 单进程断言、DSH profile bundle。

---

## 文件结构

- 创建：`pending-delete.mjs`：标记存储、预约事务、启动清理。
- 修改：`index.mjs`：挂载服务、启动清理、动态 handler RPC。
- 修改：`client.bundle.js`：第三个 Tab、预约/取消预约交互。
- 修改：`package.json`：包含新模块并升级版本。
- 修改：`test/delete-safety.test.mjs`：handler 分流回归。
- 创建：`test/pending-delete.test.mjs`：持久化与启动清理回归。
- 修改：`README.md`、`CHANGELOG.md`：行为和版本说明。

### 任务 1：持久标记服务

- [ ] 编写失败测试：标记持久化、未归档自动取消、启动删除失败保留、成功删除清理状态。
- [ ] 运行 `node test/pending-delete.test.mjs`，预期因模块不存在失败。
- [ ] 实现 `PendingDeleteService` 和 JSON 原子存储。
- [ ] 重跑测试，预期全部通过。

### 任务 2：Host handler 集成

- [ ] 扩展 handler 测试：live 非运行会话删除转为预约；列表将标记会话从 archived 分流到 pending；取消预约保持归档。
- [ ] 运行测试确认新断言失败。
- [ ] 修改 `HOST_CODE`，新增 `pending.cancel` 并调整 `archived.list/delete`。
- [ ] 重跑测试确认通过。

### 任务 3：静态 bootstrap 初始化

- [ ] 在 `apply()` 创建并 provide `sessionArchiverPending`。
- [ ] 启动时先 `processStartup()`，完成后再 sweep/bootstrap。
- [ ] 单项删除失败只记录并保留标记，不阻断其他项。

### 任务 4：Client UI

- [ ] 增加“预约删除”Tab 和计数。
- [ ] live 非运行会话删除按钮改为“预约删除”。
- [ ] pending 行提供“取消预约删除”，取消后回到已归档。
- [ ] all Tab 排除 archived 与 pending。

### 任务 5：发布元数据

- [ ] 版本升级到 `0.2.0`，将 `pending-delete.mjs` 纳入 files。
- [ ] 更新 README、CHANGELOG。
- [ ] 运行 `npm run check` 和 `npm pack --dry-run`。

### 任务 6：重新安装与验证

- [ ] 执行 `dsh plugin --profile web add <local-dir>`。
- [ ] 验证 profile dependency、bundle、裸包名导入和 dump-config。
- [ ] 停止旧不可变动态版本；说明重启后新 bootstrap 生效。
