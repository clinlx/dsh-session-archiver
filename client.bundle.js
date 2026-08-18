// dsh-session-archiver — Client bundle (static).
//
// Served by dsh-client-modules at /plugins/dsh-session-archiver/client.js and
// loaded into the browser client composition without any approval prompt (it
// is part of the profile composition the recipient already installed). The
// bundle must register itself with `window.__ModuleLoader__.load({ id, factory })`
// where `id` equals the loader entry name (this package's name).
//
// The UI talks to the per-session dynamic plugin (created by the Host half)
// through the public remote `ctx.remote.dynamicCordisRunner`: first locate the
// plugin via `inventory()`, then dispatch with `invoke(pluginId, pluginRunId,
// method, args)`.
window.__ModuleLoader__.load({
  id: "dsh-session-archiver",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require("react");
    const e = React.createElement;

    const PLUGIN_NAME = "Session Archiver v2";
    const NOT_READY = "会话管理插件尚未就绪";

    function classifySessionData(data) {
      const archived = (data && Array.isArray(data.archived)) ? data.archived : [];
      const pending = (data && Array.isArray(data.pending)) ? data.pending : [];
      let other;
      if (data && Array.isArray(data.other)) {
        other = data.other;
      } else {
        const excluded = new Set(archived.concat(pending).map((row) => row.id));
        const all = (data && Array.isArray(data.all)) ? data.all : [];
        other = all.filter((row) => !excluded.has(row.id));
      }
      return {
        archived,
        pending,
        other,
        counts: {
          archived: archived.length,
          pending: pending.length,
          other: other.length
        }
      };
    }

    // Inject this bundle's stylesheet once (the module system claims untagged
    // style tags on materialization).
    (function injectCss() {
      if (typeof document === "undefined") return;
      const tagId = "dsh-session-archiver/style.css";
      if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
        const tag = document.createElement("style");
        tag.dataset.plugin = "dsh-session-archiver";
        tag.dataset.pluginCss = tagId;
        tag.textContent =
          ".dshsa-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1200}" +
          ".dshsa-panel{width:min(600px,92vw);max-height:80vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.35);overflow:hidden}" +
          ".dshsa-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}" +
          ".dshsa-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}" +
          ".dshsa-close{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:15px;cursor:pointer}" +
          ".dshsa-close:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}" +
          ".dshsa-tabs{display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}" +
          ".dshsa-tab{padding:4px 12px;border-radius:8px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-secondary);background:transparent;border:none}" +
          ".dshsa-tab:hover{color:var(--dsw-alias-label-primary)}" +
          ".dshsa-tab-active{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}" +
          ".dshsa-body{overflow-y:auto;padding:8px;flex:1;min-height:140px}" +
          ".dshsa-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border-radius:10px}" +
          ".dshsa-row:hover{background:var(--dsw-alias-bg-layer-1)}" +
          ".dshsa-row-main{flex:1;min-width:0}" +
          ".dshsa-row-title{font-size:13px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px}" +
          ".dshsa-row-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}" +
          ".dshsa-row-actions{display:flex;gap:6px;flex:none;align-items:center}" +
          ".dshsa-btn{font-size:12px;padding:3px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}" +
          ".dshsa-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}" +
          ".dshsa-btn:disabled{opacity:.45;cursor:default}" +
          ".dshsa-btn-danger{color:var(--dsw-alias-state-error-primary)}" +
          ".dshsa-btn-danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2)}" +
          ".dshsa-error{padding:8px 16px;font-size:12px;color:var(--dsw-alias-state-error-primary);border-top:1px solid var(--dsw-alias-border-l1);flex:none}" +
          ".dshsa-empty{padding:24px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary)}" +
          "";
        document.head.appendChild(tag);
      }
    })();

    function fmtTime(ms) {
      if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }

    function Row(props) {
      const { row, archived, pending, other, busy, onOpen, onArchive, onUnarchive, onDelete, onCancelPending } = props;
      const [confirming, setConfirming] = React.useState(false);
      const busyNow = busy === row.id;
      const status = row.running ? "运行中" : (pending ? "将在下次启动时删除" : (row.live ? "已打开" : ""));
      const canDelete = !row.running;
      return e("div", { className: "dshsa-row" },
        e("div", { className: "dshsa-row-main" },
          e("div", { className: "dshsa-row-title", title: row.title || row.id },
            row.title ? row.title : "(无标题) " + row.id.slice(0, 8)
          ),
          e("div", { className: "dshsa-row-meta" },
            (row.workspaceTitle ? "工作区: " + row.workspaceTitle + " · " : "未分组 · ") + fmtTime(row.createdAt) + (status ? " · " + status : "")
          )
        ),
        e("div", { className: "dshsa-row-actions" },
          e("button", { type: "button", className: "dshsa-btn", disabled: busyNow, onClick: () => onOpen(row) }, "打开"),
          archived
            ? e("button", { type: "button", className: "dshsa-btn", disabled: busyNow, onClick: () => onUnarchive(row) }, busyNow ? "…" : "取消归档")
            : (other ? e("button", { type: "button", className: "dshsa-btn", disabled: busyNow, onClick: () => onArchive(row) }, busyNow ? "…" : "归档") : null),
          pending
            ? e("button", { type: "button", className: "dshsa-btn", disabled: busyNow, onClick: () => onCancelPending(row) }, busyNow ? "…" : "取消预约删除")
            : confirming
              ? e("span", { style: { display: "inline-flex", gap: "6px" } },
                  e("button", { type: "button", className: "dshsa-btn dshsa-btn-danger", disabled: busyNow || !canDelete, onClick: () => onDelete(row) }, row.live ? "确认预约删除" : "确认删除"),
                  e("button", { type: "button", className: "dshsa-btn", disabled: busyNow, onClick: () => setConfirming(false) }, "取消")
                )
              : e("button", {
                  type: "button",
                  className: "dshsa-btn dshsa-btn-danger",
                  disabled: busyNow || !canDelete,
                  onClick: () => setConfirming(true),
                  title: row.running ? "正在运行，无法删除" : (row.live ? "归档并预约在下次启动时删除" : "")
                }, row.live ? "预约删除" : "删除")
        )
      );
    }

    function Dialog(props) {
      const { sessionId, archiver, sessionsSvc, onClose } = props;
      const [tab, setTab] = React.useState("archived");
      const [data, setData] = React.useState(null);
      const [busy, setBusy] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [loading, setLoading] = React.useState(true);

      const load = (attempt) => {
        attempt = attempt || 0;
        setLoading(true);
        archiver.invoke(sessionId, "archived.list", {}).then((res) => {
          if (res && res.ok === true) {
            setData(res);
            setError(null);
            setLoading(false);
          } else {
            setError((res && res.error) || "加载失败");
            setLoading(false);
          }
        }).catch((err) => {
          const msg = String((err && err.message) || err);
          if (attempt < 3 && msg.indexOf(NOT_READY) !== -1) {
            archiver.schedule(() => load(attempt + 1), 800);
          } else {
            setError(msg);
            setLoading(false);
          }
        });
      };
      React.useEffect(() => { load(); }, []);

      const run = (targetId, method, after) => {
        setBusy(targetId);
        setError(null);
        archiver.invoke(sessionId, method, { sessionId: targetId }).then((res) => {
          if (res && res.ok === true) {
            if (after) after();
            load();
          } else {
            setError((res && res.error) || "操作失败");
            setBusy(null);
          }
        }).catch((err) => {
          setError(String((err && err.message) || err));
          setBusy(null);
        });
      };

      const onOpen = (row) => {
        if (row.pending) {
          run(row.id, "pending.cancel", () => {
            run(row.id, "archived.unarchive", () => {
              if (sessionsSvc && typeof sessionsSvc.open === "function") sessionsSvc.open(row.id);
            });
          });
        } else if (row.archived) {
          run(row.id, "archived.unarchive", () => {
            if (sessionsSvc && typeof sessionsSvc.open === "function") sessionsSvc.open(row.id);
          });
        } else if (sessionsSvc && typeof sessionsSvc.open === "function") {
          sessionsSvc.open(row.id);
        }
      };
      const onArchive = (row) => run(row.id, "archived.archive");
      const onUnarchive = (row) => run(row.id, "archived.unarchive");
      const onCancelPending = (row) => run(row.id, "pending.cancel");
      const onDelete = (row) => run(row.id, "archived.delete", () => {
        const mgr = sessionsSvc && sessionsSvc.manager;
        if (mgr && typeof mgr.refreshList === "function") mgr.refreshList();
      });

      const classified = classifySessionData(data);
      const archived = classified.archived;
      const pending = classified.pending;
      const other = classified.other;
      const counts = classified.counts;
      const show = tab === "archived" ? archived : (tab === "pending" ? pending : other);

      return e("div", { className: "dshsa-backdrop", onClick: onClose },
        e("div", { className: "dshsa-panel", onClick: (ev) => ev.stopPropagation() },
          e("div", { className: "dshsa-head" },
            e("div", { className: "dshsa-title" }, "会话管理"),
            e("button", { type: "button", className: "dshsa-close", onClick: onClose, title: "关闭" }, "✕")
          ),
          e("div", { className: "dshsa-tabs" },
            e("button", { type: "button", className: "dshsa-tab" + (tab === "archived" ? " dshsa-tab-active" : ""), onClick: () => setTab("archived") }, "已归档 (" + counts.archived + ")"),
            e("button", { type: "button", className: "dshsa-tab" + (tab === "all" ? " dshsa-tab-active" : ""), onClick: () => setTab("all") }, "未归档 (" + counts.other + ")"),
            e("button", { type: "button", className: "dshsa-tab" + (tab === "pending" ? " dshsa-tab-active" : ""), onClick: () => setTab("pending") }, "预约删除 (" + counts.pending + ")")
          ),
          e("div", { className: "dshsa-body" },
            loading && data === null
              ? e("div", { className: "dshsa-empty" }, "加载中…")
              : show.length === 0
                ? e("div", { className: "dshsa-empty" }, tab === "archived" ? "没有归档的会话" : (tab === "pending" ? "没有预约删除的会话" : "没有未归档的会话"))
                : show.map((row) => e(Row, {
                    key: row.id,
                    row: Object.assign({}, row, { archived: tab !== "all", pending: tab === "pending" }),
                    archived: tab === "archived",
                    pending: tab === "pending",
                    busy,
                    other: tab === "all",
                    onOpen,
                    onArchive,
                    onUnarchive,
                    onDelete,
                    onCancelPending
                  }))
          ),
          error !== null && e("div", { className: "dshsa-error" }, error)
        )
      );
    }

    function HeaderAction(props) {
      const { sessionId, archiver, sessionsSvc } = props;
      const [open, setOpen] = React.useState(false);
      return e(React.Fragment, null,
        e("button", {
          type: "button",
          className: "nL4_yW_sessionLogButton",
          onClick: () => setOpen(!open),
          title: "会话管理：查看归档会话、取消归档、删除会话"
        },
          "会话管理",
          e("svg", {
            width: 12,
            height: 12,
            viewBox: "0 0 16 16",
            fill: "none",
            xmlns: "http://www.w3.org/2000/svg",
            stroke: "currentColor",
            strokeWidth: 1.5,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            "aria-hidden": "true",
            focusable: "false"
          },
            e("path", { d: "M2.5 4.5h11" }),
            e("path", { d: "M2.5 8h11" }),
            e("path", { d: "M2.5 11.5h11" })
          )
        ),
        open ? e(Dialog, { sessionId, archiver, sessionsSvc, onClose: () => setOpen(false) }) : null
      );
    }

    const inject = ["slots", "remote", "remote.dynamicCordisRunner", "timer"];

    function apply(ctx) {
      const remote = () => ctx.remote.dynamicCordisRunner;

      async function resolvePlugin(sessionId) {
        const answered = await remote().inventory();
        if (!answered.ok) throw new Error(answered.error && answered.error.message ? answered.error.message : String((answered.error && answered.error.code) || "读取插件清单失败"));
        const rows = answered.value;
        for (const row of rows) {
          if (row.agentId !== sessionId) continue;
          const isOurs = Array.isArray(row.packages) && row.packages.some((p) => p.name === PLUGIN_NAME);
          if (isOurs && row.activeRun) return { pluginId: row.pluginId, pluginRunId: row.activeRun.pluginRunId };
        }
        return null;
      }

      async function invoke(sessionId, method, args) {
        const target = await resolvePlugin(sessionId);
        if (target === null) throw new Error(NOT_READY);
        // The remote proxy wraps the host return in {ok, value}; the host's
        // invoke wraps the handler result in ANOTHER {ok, value}.  Unwrap both.
        var answered = await remote().invoke(target.pluginId, target.pluginRunId, method, args);
        if (!answered.ok) throw new Error((answered.error && answered.error.message) || (answered.error && answered.error.code) || "调用失败");
        var result = answered.value;
        if (!result || !result.ok) throw new Error((result && (result.message || result.code)) || "调用失败");
        return result.value;
      }

      const sessionsSvc = ctx.get("sessions");
      const archiver = {
        invoke,
        schedule: (fn, ms) => ctx.timer.setTimeout(fn, ms)
      };

      ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
        name: "conversation.session.header.utilities",
        id: "session-archiver",
        order: 100,
        label: () => "会话管理",
        inject: () => ({ archiver, sessionsSvc })
      }, HeaderAction));
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.classifySessionData = classifySessionData;
    return module.exports;
  }
});
