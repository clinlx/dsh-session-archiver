# dsh-session-archiver

DeepSeek Harness (DSH) 会话管理插件：查看归档会话、取消归档和安全删除冷会话。

- 一键安装，自动挂载，零配置
- 静态 Web UI，无需逐版本审批
- Host-only 会话处理器，重启后自动重建
- 与 DSH 原生归档状态保持一致

## 从 GitHub 安装

先安装 pnpm（DSH 的插件命令会调用它）：

```bash
npm install -g pnpm
```

然后从GitHub仓库安装

```bash
dsh plugin --profile web add github:clinlx/dsh-session-archiver
```

重启 DSH：

```bash
npx @deepseek-ai/dsh web
```

打开任意会话，右上角会出现「会话管理」按钮。

## 本地开发安装

仓库克隆到本地后，在 DSH profile 中安装本地目录：

```bash
dsh plugin --profile web add "D:/path/to/dsh-session-archiver"
```

修改代码后需要重新加载插件或重启 DSH。Client bundle 变更还需要刷新浏览器页面。

## 卸载

```bash
dsh plugin --profile web remove dsh-session-archiver
```

随后重启 DSH。

## 功能

- 「已归档」「预约删除」「全部会话」三个页签
- 打开会话和取消归档
- 直接删除未加载到内存的冷会话
- 将已打开但未运行的会话归档并预约在下次 DSH 启动时删除
- 取消预约只撤销删除标记，会话仍保留在「已归档」
- 预约删除失败时保持归档和标记，下次启动自动重试
- 删除失败时保持原归档和工作区状态，不产生“未分组”假删除

## 删除安全边界

运行中或已经加载到 DSH 内存的 Session 不能由插件安全强制卸载。DSH 公共 `sessions` 服务没有按 ID 关闭或卸载 Session 的 API；SQLite 会话查询器也会重新索引仍然 live 的 Session。

因此：

- 运行中的会话：禁止删除或预约删除
- 已打开但未运行的会话：先归档并写入预约标记，不在当前进程强删
- 下一次 DSH 初始化时，插件在创建会话 handler 前处理预约删除
- 只有磁盘会话文件真正删除成功后，插件才会清除标记、取消归档并从工作区摘除
- 文件删除失败时保留归档和预约标记，下次启动重试
- 若会话已被取消归档，预约标记自动失效，不删除文件

## 项目结构

```text
dsh-session-archiver/
├── .github/workflows/validate.yml
├── test/delete-safety.test.mjs
├── test/pending-delete.test.mjs
├── package.json
├── cordis.patch.yml
├── index.mjs
├── pending-delete.mjs
├── client.bundle.js
├── CHANGELOG.md
├── LICENSE
└── README.md
```

- `cordis.patch.yml`：将插件 Host 行插入 profile 组合
- `index.mjs`：静态 Host bootstrap，先处理预约删除，再为每个 Agent 重建 host-only 动态处理器
- `pending-delete.mjs`：原子持久化预约标记，并执行启动删除事务
- `client.bundle.js`：静态 Web client bundle，注册会话管理按钮和三个页签
- `test/delete-safety.test.mjs`：确保 handler 正确预约、分流和取消
- `test/pending-delete.test.mjs`：确保标记持久化与启动失败重试语义

## License

MIT
