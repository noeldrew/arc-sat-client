import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SatelliteConfig } from "./core/config";
import type { ActivityEntry, SatelliteStatus } from "./core/events";
import type { SystemSnapshot } from "./core/system-monitor";
import type { NetworkTestState } from "./core/network-diagnostics";
import "@fontsource/sora/latin-500.css";
import "./styles.css";

const FONT_STACKS: Record<string, string> = {
  Inter: "'Inter', sans-serif",
  "System UI": "system-ui, -apple-system, 'Segoe UI', sans-serif",
  Georgia: "Georgia, 'Times New Roman', serif",
  Poppins: "'Poppins', sans-serif",
};
const applyBrandFont = (name: string | null | undefined, variable: string, linkId: string): void => {
  if (!name) return;
  const safeName = name.trim();
  if (!/^[A-Za-z0-9 ._-]+$/.test(safeName)) return;
  document.documentElement.style.setProperty(variable, FONT_STACKS[safeName] || `'${safeName}', sans-serif`);
  if (!FONT_STACKS[safeName]) {
    const link = (document.getElementById(linkId) as HTMLLinkElement | null) || document.head.appendChild(Object.assign(document.createElement("link"), { id: linkId, rel: "stylesheet" }));
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(safeName).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap`;
  }
};

const pages = [
  "Overview",
  "Trigger Events",
  "Activity Log",
  "Settings",
  "App Launcher",
  "System Monitor",
] as const;
type Page = (typeof pages)[number];

const PageIcon = ({ page }: { page: Page }): React.JSX.Element => {
  const paths: Record<Page, React.ReactNode> = {
    Overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    "Trigger Events": (
      <path d="m13 2-9 12h8l-1 8 9-12h-8l1-8Z" />
    ),
    "Activity Log": (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <path d="M7 3v6M17 9v6M9 15v6" />
      </>
    ),
    Settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.96 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.96a1.7 1.7 0 0 0-.34-1.88L4.2 7.02l2.83-2.83.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.04 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
      </>
    ),
    "App Launcher": (
      <path d="m5 3 14 9-14 9V3Z" />
    ),
    "System Monitor": (
      <>
        <path d="M3 12h4l2-7 4 14 2-7h6" />
        <path d="M21 12a9 9 0 1 1-3-6.7" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[page]}
    </svg>
  );
};

const TrashIcon = (): React.JSX.Element => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="m19 6-1 14H6L5 6" />
    <path d="M10 11v5M14 11v5" />
  </svg>
);
type ActivityPreferences = { showAcks: boolean; showPing: boolean };
const Badge = ({
  good,
  children,
}: {
  good?: boolean;
  children: React.ReactNode;
}) => <span className={`badge ${good ? "good" : "bad"}`}>● {children}</span>;
const ConnectionBadge = ({
  label,
  state,
  level,
}: {
  label: string;
  state: string;
  level: "red" | "amber" | "green";
}) => (
  <span
    className={`connection-badge ${level}`}
  >
    <i />
    <strong>{label}</strong>
    {state}
  </span>
);
const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <label className="field">
    <span>{label}</span>
    {children}
    {hint && <small>{hint}</small>}
  </label>
);
const Stat = ({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
}) => (
  <article className="stat">
    <small>{label}</small>
    <strong>{value}</strong>
    <span>{detail}</span>
  </article>
);
const eventName = (entry: ActivityEntry): string => {
  const type = String(entry.message.type ?? entry.message.detail ?? "event");
  if (type === "command" && entry.message.action)
    return `${type}: ${String(entry.message.action)}`;
  if (type === "trigger" && entry.message.trigger_id)
    return `${type}: ${String(entry.message.trigger_id)}`;
  return type;
};
const titleCaseStatus = (value: string): string =>
  value
    .split(/[-_\s]+/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
const filterActivity = (
  activity: ActivityEntry[],
  preferences: ActivityPreferences,
): ActivityEntry[] =>
  activity.filter((entry) => {
    const type = String(entry.message.type ?? "").toLowerCase();
    if (!preferences.showAcks && type === "ack") return false;
    if (!preferences.showPing && ["ping", "pong"].includes(type)) return false;
    return true;
  });

function ActivityRows({
  activity,
  compact = false,
}: {
  activity: ActivityEntry[];
  compact?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState<string>();
  if (!activity.length)
    return <div className="empty">No activity recorded yet.</div>;
  return (
    <div className="activity-list">
      {activity.map((entry, index) => {
        const key = `${entry.at}-${index}`;
        const expanded = open === key;
        return (
          <div
            className={`activity-item ${expanded ? "expanded" : ""}`}
            key={key}
          >
            <button
              className="activity-row"
              onClick={() => !compact && setOpen(expanded ? undefined : key)}
            >
              <time>{new Date(entry.at).toLocaleTimeString()}</time>
              <span className={`direction ${entry.direction}`}>
                {entry.direction}
              </span>
              <code>{eventName(entry)}</code>
              {!compact && (
                <span className="chevron">{expanded ? "▴" : "▾"}</span>
              )}
            </button>
            {expanded && (
              <div className="payload">
                <pre>{JSON.stringify(entry.message, null, 2)}</pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ActivityLog({
  activity,
  clear,
  preferences,
  setPreferences,
}: {
  activity: ActivityEntry[];
  clear: () => void;
  preferences: ActivityPreferences;
  setPreferences: React.Dispatch<React.SetStateAction<ActivityPreferences>>;
}): React.JSX.Element {
  const [scope, setScope] = useState<"all" | "cloud" | "app" | "errors">("all");
  const [group, setGroup] = useState(false);
  const filtered = filterActivity(activity, preferences).filter((entry) => {
    if (scope === "cloud" && !entry.direction.startsWith("cloud")) return false;
    if (scope === "app" && !entry.direction.startsWith("local")) return false;
    if (scope === "errors" && entry.direction !== "error") return false;
    return true;
  });
  const groups = group
    ? Object.entries(
        filtered.reduce<Record<string, ActivityEntry[]>>((all, entry) => {
          const id = String(
            entry.message.session_id ?? entry.message.sessionId ?? "No session",
          );
          (all[id] ??= []).push(entry);
          return all;
        }, {}),
      )
    : [];
  const copy = (): void => {
    void navigator.clipboard.writeText(
      filtered
        .map(
          (entry) =>
            `${entry.at} ${entry.direction} ${JSON.stringify(entry.message)}`,
        )
        .join("\n"),
    );
  };
  return (
    <>
      <div className="headline">
        <h1>Activity Log</h1>
        <p>
          Validated traffic between the ARC server, ARC Client and local app.
        </p>
      </div>
      <div className="log-toolbar">
        <div className="segmented">
          {(["all", "cloud", "app", "errors"] as const).map((item) => (
            <button
              className={scope === item ? "selected" : ""}
              onClick={() => setScope(item)}
              key={item}
            >
              {item === "all"
                ? "All"
                : item === "app"
                  ? "Local App"
                  : `${item.charAt(0).toUpperCase()}${item.slice(1)}`}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <button
            className={preferences.showAcks ? "selected" : ""}
            onClick={() =>
              setPreferences((current) => ({
                ...current,
                showAcks: !current.showAcks,
              }))
            }
          >
            Show acks
          </button>
          <button
            className={preferences.showPing ? "selected" : ""}
            onClick={() =>
              setPreferences((current) => ({
                ...current,
                showPing: !current.showPing,
              }))
            }
          >
            Show ping/pong
          </button>
          <button
            className={group ? "selected" : ""}
            onClick={() => setGroup(!group)}
          >
            Group by Session
          </button>
          <button
            className="tool-icon"
            onClick={copy}
            title="Copy visible activity"
            aria-label="Copy visible activity"
          >
            ⧉
          </button>
          <button
            className="tool-icon danger"
            onClick={clear}
            title="Clear activity"
            aria-label="Clear activity"
          >
            ⌫
          </button>
        </div>
      </div>
      <section className="panel log-panel">
        {group ? (
          groups.map(([id, entries]) => (
            <div className="session-group" key={id}>
              <h3>
                {id}
                <span>{entries.length} events</span>
              </h3>
              <ActivityRows activity={entries} />
            </div>
          ))
        ) : (
          <ActivityRows activity={filtered} />
        )}
      </section>
    </>
  );
}

function Overview({
  status,
  stats,
  activity,
}: {
  status: SatelliteStatus;
  stats?: SystemSnapshot;
  activity: ActivityEntry[];
}): React.JSX.Element {
  return (
    <>
      <div className="headline">
        <h1>ARC Client overview</h1>
        <p>Live connectivity, sessions and local transport health.</p>
      </div>
      <div className="cards">
        <Stat
          label="ARC SERVER"
          value={titleCaseStatus(status.cloud)}
          detail="Authenticated cloud WebSocket"
        />
        <Stat
          label="LOCAL APP"
          value={status.localAppConnected ? "Connected" : "Not connected"}
          detail={status.transportError ?? "WebSocket · localhost"}
        />
        <Stat
          label="ACTIVE SESSION"
          value={
            status.cloudSessionId ? status.cloudSessionId.slice(0, 8) : "None"
          }
          detail="RFID session routing"
        />
        <Stat
          label="CPU"
          value={stats ? `${stats.cpu_percent.toFixed(0)}%` : "—"}
          detail="Current system load"
        />
      </div>
      <section className="panel">
        <div className="section-title">
          <h2>Recent activity</h2>
          <span>{activity.length} messages</span>
        </div>
        <ActivityRows compact activity={activity.slice(0, 8)} />
      </section>
    </>
  );
}

function Triggers({
  config,
  save,
  addRequest,
}: {
  config: SatelliteConfig;
  save: (next: SatelliteConfig) => Promise<void>;
  addRequest: number;
}): React.JSX.Element {
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ id: "", name: "", description: "" });
  const [addError, setAddError] = useState("");
  useEffect(() => {
    if (addRequest > 0) setAdding(true);
  }, [addRequest]);
  const closeAdd = (): void => {
    setAdding(false);
    setDraft({ id: "", name: "", description: "" });
    setAddError("");
  };
  const add = async (): Promise<void> => {
    const id = draft.id.trim();
    const name = draft.name.trim();
    if (!id || !name) {
      setAddError("Trigger ID and display name are required.");
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      setAddError("Use lowercase letters, numbers and hyphens for the trigger ID.");
      return;
    }
    if (config.triggers.some((trigger) => trigger.id === id)) {
      setAddError("A trigger with this ID already exists.");
      return;
    }
    await save({
      ...config,
      triggers: [...config.triggers, { id, name, description: draft.description.trim() }],
    });
    setNotice(`Added ${name}.`);
    closeAdd();
  };
  const importSettings = async (): Promise<void> => {
    const next = await window.arcSatellite.importSettings();
    if (next)
      setNotice(
        `Imported ${next.triggers.length} triggers and client settings. This client's ID was preserved.`,
      );
  };
  return (
    <>
      <div className="headline row">
        <div>
          <h1>Trigger Events</h1>
          <p>Events registered by the local application and this client.</p>
        </div>
        <div className="actions">
          <button
            onClick={() =>
              void window.arcSatellite
                .exportSettings()
                .then(
                  (ok) =>
                    ok && setNotice("Settings exported. Client ID was excluded."),
                )
            }
          >
            Export Settings
          </button>
          <button onClick={() => void importSettings()}>Import Settings</button>
          <button className="primary" onClick={() => setAdding(true)}>
            ＋ Add Trigger
          </button>
        </div>
      </div>
      {notice && <div className="notice">{notice}</div>}
      <div className="trigger-grid">
        {config.triggers.map((trigger) => (
          <article className="trigger" key={trigger.id}>
            <div>
              <h3>{trigger.name}</h3>
              <code>{trigger.id}</code>
              <p>{trigger.description || "No description"}</p>
            </div>
            <button
              className="trash-button"
              aria-label={`Delete ${trigger.name}`}
              title={`Delete ${trigger.name}`}
              onClick={() =>
                void save({
                  ...config,
                  triggers: config.triggers.filter(
                    (item) => item.id !== trigger.id,
                  ),
                })
              }
            >
              <TrashIcon />
            </button>
          </article>
        ))}
      </div>
      {!config.triggers.length && (
        <div className="empty panel">
          Connect an ARC SDK application or add a trigger manually.
        </div>
      )}
      {adding && (
        <div className="modal-backdrop">
          <section className="modal trigger-modal" role="dialog" aria-modal="true" aria-labelledby="add-trigger-title">
            <h2 id="add-trigger-title">Add Trigger</h2>
            <p>Define an event that can be registered with the ARC server.</p>
            <div className="trigger-dialog-fields">
              <label className="field">
                <span>Trigger ID</span>
                <input
                  autoFocus
                  value={draft.id}
                  placeholder="game-completed"
                  onChange={(event) => setDraft({ ...draft, id: event.target.value })}
                />
                <small>Lowercase letters, numbers and hyphens.</small>
              </label>
              <label className="field">
                <span>Display Name</span>
                <input
                  value={draft.name}
                  placeholder="Game Completed"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Description</span>
                <textarea
                  rows={4}
                  value={draft.description}
                  placeholder="Explain when this trigger is sent."
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </label>
            </div>
            {addError && <p className="dialog-error">{addError}</p>}
            <div className="actions dialog-actions">
              <button type="button" onClick={closeAdd}>Cancel</button>
              <button type="button" className="primary" onClick={() => void add()}>Add Trigger</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function Settings({
  config,
  save,
}: {
  config: SatelliteConfig;
  save: (next: SatelliteConfig) => Promise<void>;
}): React.JSX.Element {
  const [draft, setDraft] = useState(config);
  const [saved, setSaved] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [zoneResult, setZoneResult] = useState<{
    available: boolean;
    zones: Array<{ id: string; name: string }>;
    reason?: string;
  }>({ available: false, zones: [], reason: "Loading zones…" });
  useEffect(() => setDraft(config), [config]);
  useEffect(() => {
    if (!window.arcSatellite) {
      setZoneResult({
        available: true,
        zones: [{ id: "preview", name: "Zone A" }],
      });
      return;
    }
    void window.arcSatellite.getZones().then(setZoneResult);
  }, [config.siteId, config.serverUrl, config.apiToken]);
  const update = <K extends keyof SatelliteConfig>(
    key: K,
    value: SatelliteConfig[K],
  ): void => setDraft({ ...draft, [key]: value });
  return (
    <>
      <div className="headline">
        <h1>Settings</h1>
        <p>
          Device identity, deployment, ARC server and local application
          connections.
        </p>
      </div>
      <section className="panel form">
        <h2>Identity</h2>
        <div className="form-grid">
          <Field label="Device Name">
            <input
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </Field>
          <Field
            label="Client ID"
            hint="Unique to this PC and never replaced when importing settings."
          >
            <input className="mono" readOnly value={draft.clientId} />
          </Field>
          <Field label="Description (optional)">
            <input
              placeholder="e.g. Main game pod — Zone A"
              value={draft.description}
              onChange={(e) => update("description", e.target.value)}
            />
          </Field>
        </div>
      </section>
      <section className="panel form">
        <h2>Deployment</h2>
        <div className="form-grid">
          <Field
            label="Site ID (optional)"
            hint="UUID from ARC Admin Portal → Manage Sites"
          >
            <input
              className="mono"
              value={draft.siteId ?? ""}
              onChange={(e) => update("siteId", e.target.value || undefined)}
            />
          </Field>
          <Field
            label="Zone"
            hint={
              zoneResult.available
                ? "Zones loaded from the ARC server."
                : (zoneResult.reason ?? "Zones are unavailable.")
            }
          >
            <select
              disabled={!zoneResult.available}
              value={draft.zone}
              onChange={(e) => update("zone", e.target.value)}
            >
              <option value="">— Not set —</option>
              {zoneResult.zones.map((zone) => (
                <option value={zone.name} key={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Application Type">
            <select
              value={draft.applicationType}
              onChange={(e) => update("applicationType", e.target.value)}
            >
              <option value="">— Not set —</option>
              {[
                "Game",
                "Interaction",
                "Media Player",
                "Checkpoint",
                "Kinetic",
                "Other",
              ].map((item) => (
                <option value={item.toLowerCase().replace(" ", "-")} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>
      <section className="panel form">
        <h2>ARC Connection</h2>
        <div className="form-grid">
          <Field label="Platform Server URL">
            <input
              value={draft.serverUrl}
              onChange={(e) => update("serverUrl", e.target.value)}
            />
          </Field>
          <Field label="API Token">
            <div className="input-action">
              <input
                type={showToken ? "text" : "password"}
                value={draft.apiToken ?? ""}
                onChange={(e) =>
                  update("apiToken", e.target.value || undefined)
                }
              />
              <button onClick={() => setShowToken(!showToken)}>
                {showToken ? "Hide" : "Show"}
              </button>
            </div>
          </Field>
        </div>
      </section>
      <section className="panel form">
        <h2>Local App Transports</h2>
        <p>
          The SDK normally connects to the local WebSocket. Optional transports
          support other integrations.
        </p>
        <div className="form-grid transports">
          <Field label="WebSocket Port">
            <input
              type="number"
              value={draft.localWsPort}
              onChange={(e) => update("localWsPort", Number(e.target.value))}
            />
          </Field>
          {(
            [
              ["HTTP", "localHttpEnabled", "localHttpPort"],
              ["TCP", "localTcpEnabled", "localTcpPort"],
              ["UDP", "localUdpEnabled", "localUdpPort"],
            ] as const
          ).map(([label, enabled, port]) => (
            <div className="transport-setting" key={label}>
              <label>
                <input
                  type="checkbox"
                  checked={draft[enabled]}
                  onChange={(e) => update(enabled, e.target.checked)}
                />
                {label} enabled
              </label>
              <input
                type="number"
                value={draft[port]}
                onChange={(e) => update(port, Number(e.target.value))}
              />
            </div>
          ))}
        </div>
      </section>
      <section className="panel form">
        <h2>Client Display</h2>
        <label className="check-line">
          <input
            type="checkbox"
            checked={draft.clientFullscreen}
            onChange={(e) => update("clientFullscreen", e.target.checked)}
          />
          Launch ARC Client in fullscreen
        </label>
        <p>This takes effect the next time the ARC Client starts.</p>
      </section>
      <div className="actions">
        <button
          className="primary"
          onClick={() =>
            void save(draft).then(() => {
              setSaved(true);
              setTimeout(() => setSaved(false), 2000);
            })
          }
        >
          Save & Reconnect
        </button>
        <button onClick={() => void window.arcSatellite.exportDiagnostics()}>
          Export Diagnostics
        </button>
        {saved && <span className="success">Saved</span>}
      </div>
    </>
  );
}

function MonitoredProcesses({
  stats,
  config,
  save,
}: {
  stats?: SystemSnapshot;
  config: SatelliteConfig;
  save: (next: SatelliteConfig) => Promise<void>;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const add = (): void => {
    const processName = name.trim();
    if (!processName || config.monitoring.processes.includes(processName)) return;
    void save({
      ...config,
      monitoring: {
        ...config.monitoring,
        processes: [...config.monitoring.processes, processName],
      },
    });
    setName("");
  };
  return (
    <section className="panel form">
      <div className="section-title">
        <div>
          <h2>Monitored Processes</h2>
          <p>
            The ARC Client alerts the server when these processes start or
            stop unexpectedly.
          </p>
        </div>
      </div>
      <div className="process-list">
        {config.monitoring.processes.map((processName) => (
          <div key={processName}>
            <Badge good={stats?.processes[processName]}>
              {processName} · {stats?.processes[processName] ? "Running" : "Stopped"}
            </Badge>
            <button
              className="icon"
              onClick={() =>
                void save({
                  ...config,
                  monitoring: {
                    ...config.monitoring,
                    processes: config.monitoring.processes.filter(
                      (item) => item !== processName,
                    ),
                  },
                })
              }
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="add-process">
        <input
          placeholder="Process name, e.g. Zombears"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="primary" onClick={add}>
          Add
        </button>
      </div>
    </section>
  );
}

function Launcher({
  config,
  save,
  stats,
}: {
  config: SatelliteConfig;
  save: (next: SatelliteConfig) => Promise<void>;
  stats?: SystemSnapshot;
}): React.JSX.Element {
  const [draft, setDraft] = useState(config.launcher);
  const [dragging, setDragging] = useState(false);
  const [detectedProcess, setDetectedProcess] = useState("");
  useEffect(() => setDraft(config.launcher), [config]);
  useEffect(() => {
    if (!config.launcher.path) return;
    if (!window.arcSatellite) {
      setDetectedProcess("Zombears");
      return;
    }
    void window.arcSatellite
      .detectProcess(config.launcher.path)
      .then(setDetectedProcess);
  }, [config.launcher.path]);
  const choose = async (): Promise<void> => {
    const selected = await window.arcSatellite.chooseApplication();
    if (selected) {
      setDraft({ ...draft, path: selected, type: "file" });
      setDetectedProcess(await window.arcSatellite.detectProcess(selected));
    }
  };
  const drop = (event: React.DragEvent): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      const selected = window.arcSatellite.getPathForFile(file);
      setDraft({
        ...draft,
        path: selected,
        type: "file",
      });
      void window.arcSatellite.detectProcess(selected).then(setDetectedProcess);
    }
  };
  const saveOptions = (): void => {
    const processes =
      detectedProcess && !config.monitoring.processes.includes(detectedProcess)
        ? [...config.monitoring.processes, detectedProcess]
        : config.monitoring.processes;
    void save({
      ...config,
      launcher: draft,
      monitoring: { ...config.monitoring, processes },
    });
  };
  return (
    <>
      <div className="headline">
        <h1>App Launcher</h1>
        <p>
          Configure how the ARC Client launches and supervises the local
          application.
        </p>
      </div>
      <section className="panel form">
        <h2>Application / File</h2>
        <p>Select an executable, application, shortcut, or any file to open.</p>
        <div className="path-row">
          <input
            className="mono"
            value={draft.path}
            onChange={(e) =>
              setDraft({ ...draft, path: e.target.value, type: "file" })
            }
            onBlur={() => {
              if (draft.path)
                void window.arcSatellite
                  .detectProcess(draft.path)
                  .then(setDetectedProcess);
            }}
          />
          <button onClick={() => void choose()}>Browse…</button>
        </div>
        <div
          className={`drop-zone ${dragging ? "dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          Drop an application, file, or shortcut here
        </div>
      </section>
      <section className="panel form">
        <h2>Startup Script</h2>
        <p>
          Run a bash/shell script in addition to or instead of the selected
          file.
        </p>
        <textarea
          className="code-editor"
          spellCheck={false}
          placeholder="#!/bin/bash"
          value={draft.script}
          onChange={(e) =>
            setDraft({
              ...draft,
              script: e.target.value,
              type: e.target.value ? "script" : draft.path ? "file" : "none",
            })
          }
        />
      </section>
      <section className="panel form">
        <h2>Launch Options</h2>
        <div className="checks single">
          {(
            [
              ["onConnect", "Auto-launch when connected to ARC server"],
              ["onClientStart", "Auto-launch when the ARC Client starts"],
              ["onSession", "Auto-launch when a player session starts"],
              ["autoRelaunch", "Auto-relaunch if a monitored process stops"],
              ["queueSession", "Queue last session when app is not running"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={draft[key]}
                onChange={(e) =>
                  setDraft({ ...draft, [key]: e.target.checked })
                }
              />
              {label}
            </label>
          ))}
        </div>
        {detectedProcess && (
          <div className="detected-process">
            Monitoring process will be added automatically:{" "}
            <strong>{detectedProcess}</strong>
          </div>
        )}
        <div className="compact-fields">
          <Field label="Relaunch cooldown">
            <div className="unit">
              <input
                type="number"
                value={draft.relaunchCooldownSeconds}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    relaunchCooldownSeconds: Number(e.target.value),
                  })
                }
              />
              <span>s</span>
            </div>
          </Field>
          <Field label="Auto-launch delay">
            <div className="unit">
              <input
                type="number"
                value={draft.delaySeconds}
                onChange={(e) =>
                  setDraft({ ...draft, delaySeconds: Number(e.target.value) })
                }
              />
              <span>s</span>
            </div>
          </Field>
          <Field label="Client-start delay">
            <div className="unit">
              <input
                type="number"
                value={draft.clientStartDelaySeconds}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    clientStartDelaySeconds: Number(e.target.value),
                  })
                }
              />
              <span>s</span>
            </div>
          </Field>
        </div>
      </section>
      <div className="actions">
        <button className="primary" onClick={saveOptions}>
          Save Options
        </button>
        <button onClick={() => void window.arcSatellite.launchApp()}>
          ▶ Launch Now
        </button>
      </div>
      <MonitoredProcesses stats={stats} config={config} save={save} />
    </>
  );
}

const formatUptime = (seconds?: number): string =>
  seconds === undefined
    ? "—"
    : `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
const formatRate = (bytes?: number): string =>
  bytes === undefined
    ? "—"
    : bytes >= 1048576
      ? `${(bytes / 1048576).toFixed(1)} MB/s`
      : `${(bytes / 1024).toFixed(1)} KB/s`;
function Monitor({
  stats,
  config,
  save,
  openConsole,
  networkTest,
}: {
  stats?: SystemSnapshot;
  config: SatelliteConfig;
  save: (next: SatelliteConfig) => Promise<void>;
  openConsole: () => void;
  networkTest: NetworkTestState;
}): React.JSX.Element {
  const [monitoring, setMonitoring] = useState(config.monitoring);
  const [networkTestError, setNetworkTestError] = useState("");
  useEffect(() => setMonitoring(config.monitoring), [config.monitoring]);
  const runNetworkTest = async (): Promise<void> => {
    setNetworkTestError("");
    try { await window.arcSatellite.runNetworkTest(); }
    catch (error) { setNetworkTestError(error instanceof Error ? error.message : String(error)); }
  };
  const batteryState = !stats?.battery_has_battery
    ? "Not present"
    : `${stats.battery_percent?.toFixed(0)}% — ${stats.battery_ac_connected ? (stats.battery_charging ? "Plugged in · charging" : "Plugged in · not charging") : "On battery"}`;
  return (
    <>
      <div className="headline row">
        <div>
          <h1>System Monitor</h1>
          <p>
            Detailed hardware health, throughput and supervised attraction
            processes.
          </p>
        </div>
        <button onClick={openConsole}>Open System Console</button>
      </div>
      <div className="cards monitor">
        <Stat
          label="CPU USAGE"
          value={stats ? `${stats.cpu_percent.toFixed(1)}%` : "—"}
          detail={
            stats?.cpu_freq_ghz
              ? `${stats.cpu_freq_ghz.toFixed(2)} GHz`
              : "Frequency unavailable"
          }
        />
        <Stat
          label="RAM USAGE"
          value={stats ? `${stats.ram_percent.toFixed(1)}%` : "—"}
          detail={
            stats
              ? `${(stats.ram_used_mb / 1024).toFixed(2)} / ${(stats.ram_total_mb / 1024).toFixed(2)} GB`
              : "Awaiting sample"
          }
        />
        <Stat
          label="SYSTEM UPTIME"
          value={formatUptime(stats?.uptime_seconds)}
          detail={stats ? `${stats.hostname} · ${stats.os}` : "Awaiting sample"}
        />
        <Stat
          label="DISK USAGE"
          value={
            stats?.disk_percent !== undefined
              ? `${stats.disk_percent.toFixed(1)}%`
              : "—"
          }
          detail={
            stats?.disk_total_gb
              ? `${stats.disk_used_gb?.toFixed(1)} / ${stats.disk_total_gb.toFixed(1)} GB`
              : "Unavailable"
          }
        />
        <Stat
          label="SWAP USED"
          value={stats ? `${stats.swap_percent.toFixed(1)}%` : "—"}
          detail="Virtual memory"
        />
        <Stat
          label="NETWORK DOWNLOAD"
          value={formatRate(stats?.network_rx_bytes_sec)}
          detail="Current receive rate"
        />
        <Stat
          label="NETWORK UPLOAD"
          value={formatRate(stats?.network_tx_bytes_sec)}
          detail="Current transmit rate"
        />
        <Stat
          label="SAMPLED"
          value={stats ? new Date(stats.sampled_at).toLocaleTimeString() : "—"}
          detail="Live health interval"
        />
      </div>
      <section className="panel form network-diagnostics">
        <div className="section-title">
          <div><h2>Network Diagnostics</h2><p>Adapter link and measured performance to this ARC server. Tests use real bandwidth.</p></div>
          <div className="actions">
            {networkTest.running ? <button onClick={() => void window.arcSatellite.cancelNetworkTest()}>Cancel Test</button> : <button className="primary" onClick={() => void runNetworkTest()}>Run Speed Test</button>}
          </div>
        </div>
        <div className="network-results">
          <Stat label="ADAPTER" value={stats?.network_adapter_name ?? "—"} detail={`${stats?.network_adapter_type ?? "Unknown"}${stats?.network_ip4 ? ` · ${stats.network_ip4}` : ""}`} />
          <Stat label="LINK SPEED" value={stats?.network_link_speed_mbps ? `${stats.network_link_speed_mbps} Mbps` : "—"} detail="Negotiated adapter speed" />
          <Stat label="ARC LATENCY" value={networkTest.result?.latencyMs !== undefined ? `${networkTest.result.latencyMs.toFixed(0)} ms` : networkTest.running ? "Testing…" : "—"} detail={networkTest.result?.jitterMs !== undefined ? `Jitter ${networkTest.result.jitterMs.toFixed(0)} ms` : networkTest.stage} />
          <Stat label="ARC DOWNLOAD" value={networkTest.result?.downloadMbps !== undefined ? `${networkTest.result.downloadMbps.toFixed(1)} Mbps` : "—"} detail="Measured throughput" />
          <Stat label="ARC UPLOAD" value={networkTest.result?.uploadMbps !== undefined ? `${networkTest.result.uploadMbps.toFixed(1)} Mbps` : "—"} detail="Measured throughput" />
          <Stat label="RESULT" value={networkTest.running ? networkTest.stage : networkTest.result?.status ?? "Not tested"} detail={networkTest.result?.testedAt ? new Date(networkTest.result.testedAt).toLocaleString() : "Runs automatically at startup"} />
        </div>
        {networkTest.result?.error && <div className="recovery-error">{networkTest.result.error}</div>}
        {networkTestError && <div className="recovery-error">{networkTestError}</div>}
        {!!networkTest.result?.reasons.length && <div className="notice">Below configured targets: {networkTest.result.reasons.join(" · ")}</div>}
        {!!networkTest.history.length && <div className="network-history"><h3>Recent tests</h3><div className="network-history-header"><span>Date / Time</span><span>Result</span><span>Latency</span><span>Download</span><span>Upload</span></div>{networkTest.history.slice(0, 5).map((item) => <div key={item.testedAt}><time>{new Date(item.testedAt).toLocaleString()}</time><strong className={item.status}>{item.status}</strong><span>{item.latencyMs?.toFixed(0) ?? "—"} ms</span><span>↓ {item.downloadMbps?.toFixed(1) ?? "—"} Mbps</span><span>↑ {item.uploadMbps?.toFixed(1) ?? "—"} Mbps</span></div>)}</div>}
      </section>
      <section className="panel form">
        <h2>CPU Cores</h2>
        <div className="core-grid">
          {stats?.cpu_per_core.map((load, index) => (
            <div className="core" key={index}>
              <span>Core {index}</span>
              <strong>{load.toFixed(0)}%</strong>
              <div>
                <i
                  style={{ width: `${Math.min(load, 100)}%` }}
                  className={load >= 85 ? "hot" : ""}
                />
              </div>
            </div>
          )) ?? <div className="empty">Awaiting CPU data.</div>}
        </div>
      </section>
      <section className="panel form">
        <h2>Hardware Sensors</h2>
        <p>
          Sensor availability varies by operating system and hardware
          permissions.
        </p>
        <div className="sensor-list">
          <div>
            <span>Temperature sensors</span>
            <strong>
              {stats?.cpu_temperature_c !== undefined
                ? `${stats.cpu_temperature_c.toFixed(1)} °C`
                : "Not supported"}
            </strong>
          </div>
          <div>
            <span>Fan speeds</span>
            <strong>
              {stats?.fan_rpm?.length
                ? stats.fan_rpm.map((rpm) => `${rpm} RPM`).join(", ")
                : "Not supported"}
            </strong>
          </div>
          <div>
            <span>Battery</span>
            <strong>{batteryState}</strong>
          </div>
          <div>
            <span>GPU</span>
            <strong>
              {stats?.gpus?.length
                ? stats.gpus
                    .map(
                      (gpu) =>
                        `${gpu.model}${gpu.temperature_c !== undefined ? ` · ${gpu.temperature_c} °C` : ""}`,
                    )
                    .join("; ")
                : "Not supported"}
            </strong>
          </div>
        </div>
      </section>
      <section className="panel form">
        <h2>Health Reporting</h2>
        <p>
          Set the thresholds and sampling interval used for server health
          alerts.
        </p>
        <div className="form-grid health-fields">
          {(
            [
              ["CPU alert threshold (%)", "cpuThreshold"],
              ["RAM alert threshold (%)", "ramThreshold"],
              ["Disk alert threshold (%)", "diskThreshold"],
              ["Sample interval (seconds)", "intervalSeconds"],
              ["ARC latency warning (ms)", "networkLatencyThresholdMs"],
              ["Minimum ARC download (Mbps)", "networkDownloadMinimumMbps"],
              ["Minimum ARC upload (Mbps)", "networkUploadMinimumMbps"],
            ] as const
          ).map(([label, key]) => (
            <Field label={label} key={key}>
              <input
                type="number"
                value={monitoring[key]}
                onChange={(e) =>
                  setMonitoring({
                    ...monitoring,
                    [key]: Number(e.target.value),
                  })
                }
              />
            </Field>
          ))}
        </div>
        <button
          className="save-monitoring"
          onClick={() => void save({ ...config, monitoring })}
        >
          Save Monitoring Settings
        </button>
      </section>
    </>
  );
}

function SystemConsole({
  activity,
  close,
  standalone = false,
}: {
  activity: ActivityEntry[];
  close: () => void;
  standalone?: boolean;
}): React.JSX.Element {
  const [autoScroll, setAutoScroll] = useState(true);
  const [expanded, setExpanded] = useState<string>();
  const scrollArea = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => [...activity].reverse(), [activity]);
  const text = entries
    .map(
      (entry) =>
        `[${new Date(entry.at).toLocaleTimeString()}] ${entry.direction.toUpperCase()} ${JSON.stringify(entry.message, null, 2)}`,
    )
    .join("\n\n");
  useEffect(() => {
    if (!autoScroll || !scrollArea.current) return;
    scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
  }, [entries, autoScroll]);

  const syntaxJson = (value: Record<string, unknown>): React.JSX.Element => {
    const json = JSON.stringify(value, null, 2);
    const tokens = json.split(
      /(\"(?:\\.|[^\"\\])*\"\s*:|\"(?:\\.|[^\"\\])*\"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)/gi,
    );
    return (
      <pre className="syntax-json">
        {tokens.map((token, index) => {
          let kind = "";
          if (/^\".*\"\s*:$/.test(token)) kind = "json-key";
          else if (/^\"/.test(token)) kind = "json-string";
          else if (/^(true|false)$/.test(token)) kind = "json-boolean";
          else if (token === "null") kind = "json-null";
          else if (/^-?\d/.test(token)) kind = "json-number";
          return kind ? (
            <span className={kind} key={index}>{token}</span>
          ) : (
            token
          );
        })}
      </pre>
    );
  };
  return (
    <div className={standalone ? "console-window" : "modal-backdrop"}>
      {standalone && (
        <div className="console-custom-titlebar" aria-hidden="true">
          ARC Client System Console
        </div>
      )}
      <section className={`console-modal ${standalone ? "standalone" : ""}`}>
        <div className="console-title">
          <div>
            <h2>ARC Client System Console</h2>
            <p>
              Raw server, local app, transport and system events from this run.
            </p>
          </div>
          <div className="actions">
            <label className="console-auto-scroll">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(event) => setAutoScroll(event.target.checked)}
              />
              Auto-scroll
            </label>
            <button onClick={() => void navigator.clipboard.writeText(text)}>
              Copy Logs
            </button>
            <button onClick={close}>Close</button>
          </div>
        </div>
        <div className="console-entries" ref={scrollArea}>
          {!entries.length && (
            <div className="console-empty">No system events have been recorded yet.</div>
          )}
          {entries.map((entry, index) => {
            const key = `${entry.at}-${entry.direction}-${JSON.stringify(entry.message)}`;
            const isExpanded = expanded === key;
            return (
              <div className={`console-entry ${isExpanded ? "expanded" : ""}`} key={key}>
                <div className="console-line">
                  <button
                    className="console-line-number"
                    aria-label={`${isExpanded ? "Hide" : "View"} full message for line ${index + 1}`}
                    aria-expanded={isExpanded}
                    onClick={() => setExpanded(isExpanded ? undefined : key)}
                  >
                    {String(index + 1).padStart(4, "0")}
                  </button>
                  <time>{new Date(entry.at).toLocaleTimeString()}</time>
                  <span className={`direction ${entry.direction}`}>{entry.direction}</span>
                  <strong>{eventName(entry)}</strong>
                  <code>{JSON.stringify(entry.message)}</code>
                </div>
                {isExpanded && syntaxJson(entry.message)}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ConsoleWindow(): React.JSX.Element {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  useEffect(() => {
    const off = window.arcSatellite.onActivity((entry) =>
      setActivity((current) => [entry, ...current].slice(0, 1000)),
    );
    void window.arcSatellite.getActivity().then((history) =>
      setActivity((current) => {
        const combined = [...current, ...history.slice(-1000).reverse()];
        const seen = new Set<string>();
        return combined.filter((entry) => {
          const key = `${entry.at}-${entry.direction}-${JSON.stringify(entry.message)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 1000);
      }),
    );
    return off;
  }, []);
  useEffect(() => {
    void window.arcSatellite.getBranding().then((branding) => {
      const sidebar = branding.sidebar_background_colour ?? "#101a35";
      const sidebarText = branding.sidebar_text_colour ?? "#ffffff";
      document.documentElement.style.setProperty("--arc-sidebar", sidebar);
      document.documentElement.style.setProperty("--arc-sidebar-text", sidebarText);
      void window.arcSatellite.setTitlebarColors(sidebar, sidebarText);
    });
  }, []);
  return <SystemConsole activity={activity} close={() => window.close()} standalone />;
}

function SplashScreen(): React.JSX.Element {
  const [exiting, setExiting] = useState(false);
  useEffect(() => window.arcSatellite.onSplashExit(() => setExiting(true)), []);
  return (
    <main className={`startup-splash ${exiting ? "is-exiting" : ""}`}>
      <section className="splash-content">
        <div className="splash-index">ARC / CLIENT</div>
        <svg className="splash-arc-mark" viewBox="0 0 120 120" role="img" aria-label="ARC Client">
          <path d="M14 47h24l20-20h34" />
          <path d="m79 14 13 13-13 13" />
          <path d="M106 73H82L62 93H28" />
          <path d="m41 80-13 13 13 13" />
          <path d="M92 27 28 93" />
        </svg>
        <p className="splash-powered">Powered by ARC</p>
        <p className="splash-developer">© BD&amp;R Software 2026</p>
        <div className="splash-progress" aria-hidden="true"><span /></div>
      </section>
    </main>
  );
}

function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>("Overview");
  const [addTriggerRequest, setAddTriggerRequest] = useState(0);
  const [status, setStatus] = useState<SatelliteStatus>({
    cloud: "stopped",
    localTransport: "stopped",
    localAppConnected: false,
    localAppRegistered: false,
    triggersRegistered: false,
  });
  const [config, setConfig] = useState<SatelliteConfig>();
  const [stats, setStats] = useState<SystemSnapshot>();
  const [networkTest, setNetworkTest] = useState<NetworkTestState>({ running: false, stage: "idle", history: [] });
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [activityPreferences, setActivityPreferences] =
    useState<ActivityPreferences>({ showAcks: false, showPing: false });
  const [brandName, setBrandName] = useState("ARC");
  const [brandLogo, setBrandLogo] = useState<string>();
  const [logoOnly, setLogoOnly] = useState(false);
  const [launchPending, setLaunchPending] = useState<{
    reason: string;
    delaySeconds: number;
  }>();
  const [launchSecondsRemaining, setLaunchSecondsRemaining] = useState(0);
  const [portConflict, setPortConflict] = useState<{
    port: number;
    pid: number;
    command: string;
    user: string;
  }>();
  const [dismissedConflict, setDismissedConflict] = useState<string>();
  const [recoveringPort, setRecoveringPort] = useState(false);
  const [portRecoveryError, setPortRecoveryError] = useState<string>();
  useEffect(() => {
    if (!launchPending) {
      setLaunchSecondsRemaining(0);
      return;
    }
    const deadline = Date.now() + launchPending.delaySeconds * 1_000;
    const update = (): void =>
      setLaunchSecondsRemaining(
        Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)),
      );
    update();
    const interval = setInterval(update, 250);
    const close = setTimeout(
      () => setLaunchPending(undefined),
      launchPending.delaySeconds * 1_000 + 250,
    );
    return () => {
      clearInterval(interval);
      clearTimeout(close);
    };
  }, [launchPending]);
  useEffect(() => {
    if (!window.arcSatellite || status.localTransport !== "error") {
      setPortConflict(undefined);
      setPortRecoveryError(undefined);
      return;
    }
    void window.arcSatellite.getPortConflict().then((holder) => {
      if (!holder) return;
      const key = `${holder.port}:${holder.pid}`;
      if (key !== dismissedConflict) setPortConflict(holder);
    }).catch(() => undefined);
  }, [status.localTransport, status.transportError, dismissedConflict]);
  useEffect(() => {
    if (!window.arcSatellite) {
      if (import.meta.env.DEV) {
        setConfig({
          schemaVersion: 1,
          clientId: "00000000-0000-4000-8000-000000000001",
          name: "ARC Client Preview",
          description: "",
          zone: "Zone A",
          applicationType: "game",
          serverUrl: "http://localhost:8080",
          clientFullscreen: false,
          localWsPort: 25585,
          localHttpEnabled: true,
          localHttpPort: 25586,
          localTcpEnabled: true,
          localTcpPort: 25587,
          localUdpEnabled: true,
          localUdpPort: 25588,
          triggers: [],
          launcher: {
            type: "file",
            path: "/Applications/Zombears.app",
            script: "",
            onConnect: false,
            onClientStart: true,
            clientStartDelaySeconds: 5,
            onSession: false,
            delaySeconds: 5,
            queueSession: true,
            autoRelaunch: false,
            relaunchCooldownSeconds: 60,
          },
          monitoring: {
            processes: ["Zombears"],
            cpuThreshold: 85,
            ramThreshold: 90,
            diskThreshold: 90,
            intervalSeconds: 15,
            networkLatencyThresholdMs: 100,
            networkDownloadMinimumMbps: 10,
            networkUploadMinimumMbps: 5,
          },
        });
        setStatus({
          cloud: "connected",
          localTransport: "connected",
          localAppConnected: true,
          localAppRegistered: true,
          triggersRegistered: true,
        });
        const at = new Date().toISOString();
        setActivity([
          {
            at,
            direction: "cloud-in",
            message: {
              type: "command",
              action: "session_start",
              session_id: "preview-session",
            },
          },
          {
            at,
            direction: "cloud-out",
            message: { type: "trigger", trigger_id: "game-started" },
          },
          { at, direction: "local-in", message: { type: "hello" } },
          { at, direction: "local-out", message: { type: "ack" } },
          { at, direction: "system", message: { type: "local-app-connected" } },
          {
            at,
            direction: "error",
            message: { detail: "Example connection error" },
          },
          { at, direction: "cloud-in", message: { type: "ping" } },
        ]);
      }
      return;
    }
    let liveStatusSeen = false;
    const off = [
      window.arcSatellite.onStatus((next) => {
        liveStatusSeen = true;
        setStatus(next);
      }),
      window.arcSatellite.onConfig(setConfig),
      window.arcSatellite.onSystemStats(setStats),
      window.arcSatellite.onNetworkTest(setNetworkTest),
      window.arcSatellite.onActivity((entry) =>
        setActivity((current) => [entry, ...current].slice(0, 1000)),
      ),
      window.arcSatellite.onLaunchScheduled(setLaunchPending),
      window.arcSatellite.onLaunchCancelled(() => setLaunchPending(undefined)),
      window.arcSatellite.onAddTrigger(() => {
        setPage("Trigger Events");
        setAddTriggerRequest((current) => current + 1);
      }),
    ];
    void Promise.all([
      window.arcSatellite.getStatus(),
      window.arcSatellite.getConfig(),
      window.arcSatellite.getSystemStats(),
      window.arcSatellite.getBranding(),
      window.arcSatellite.getActivity(),
      window.arcSatellite.getNetworkTest(),
    ]).then(([s, c, system, branding, history, initialNetworkTest]) => {
      if (!liveStatusSeen) setStatus(s);
      setConfig(c);
      setStats(system);
      setActivity((current) => {
        const combined = [...current, ...history.slice(-1000).reverse()];
        const seen = new Set<string>();
        return combined
          .filter((entry) => {
            const key = `${entry.at}-${entry.direction}-${JSON.stringify(entry.message)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, 1000);
      });
      setNetworkTest(initialNetworkTest);
      setBrandName(branding.platform_name);
      setBrandLogo(branding.logo_url ?? undefined);
      setLogoOnly(branding.logo_only);
      applyBrandFont(branding.font_family, "--arc-font-family", "arc-base-google-font");
      applyBrandFont(branding.title_font_family || branding.font_family, "--arc-title-font-family", "arc-title-google-font");
      const root = document.documentElement.style;
      const values: Array<[string, string | null | undefined]> = [
        ["--arc-primary", branding.primary_colour],
        ["--arc-accent", branding.accent_colour],
        ["--arc-bg", branding.background_colour],
        ["--arc-text", branding.text_colour],
        ["--arc-muted-bg", branding.muted_colour],
        ["--arc-sidebar", branding.sidebar_background_colour],
        ["--arc-sidebar-text", branding.sidebar_text_colour],
        ["--arc-sidebar-hover", branding.sidebar_hover_background_colour],
        ["--arc-sidebar-selected", branding.sidebar_selected_background_colour],
        ["--arc-border", branding.border_colour],
        [
          "--arc-radius",
          branding.corner_radius_px !== null &&
          branding.corner_radius_px !== undefined
            ? `${branding.corner_radius_px}px`
            : undefined,
        ],
        [
          "--arc-font-size",
          branding.base_font_size_px
            ? `${branding.base_font_size_px}px`
            : undefined,
        ],
        [
          "--arc-input-height",
          branding.input_height_px
            ? `${branding.input_height_px}px`
            : undefined,
        ],
      ];
      values.forEach(([key, value]) => {
        if (value) root.setProperty(key, value);
      });
      void window.arcSatellite.setTitlebarColors(
        "#ffffff",
        branding.text_colour ?? "#14213d",
      );
      requestAnimationFrame(() =>
        requestAnimationFrame(() => window.arcSatellite.uiReady()),
      );
    });
    return () => off.forEach((dispose) => dispose());
  }, []);
  const save = async (next: SatelliteConfig): Promise<void> => {
    const saved = await window.arcSatellite.updateConfig(next);
    setConfig(saved);
  };
  const body = useMemo(() => {
    if (!config) return <div className="empty">Loading configuration…</div>;
    switch (page) {
      case "Overview":
        return (
          <Overview
            status={status}
            stats={stats}
            activity={filterActivity(activity, activityPreferences)}
          />
        );
      case "Trigger Events":
        return <Triggers config={config} save={save} addRequest={addTriggerRequest} />;
      case "Activity Log":
        return (
          <ActivityLog
            activity={activity}
            clear={() => setActivity([])}
            preferences={activityPreferences}
            setPreferences={setActivityPreferences}
          />
        );
      case "Settings":
        return <Settings config={config} save={save} />;
      case "App Launcher":
        return <Launcher config={config} save={save} stats={stats} />;
      case "System Monitor":
        return (
          <Monitor
            stats={stats}
            config={config}
            save={save}
            openConsole={() => void window.arcSatellite.openConsole()}
            networkTest={networkTest}
          />
        );
    }
  }, [page, config, status, stats, activity, activityPreferences, networkTest, addTriggerRequest]);
  const serverLevel: "red" | "amber" | "green" =
    status.cloud === "connected"
      ? "green"
      : ["connecting", "registering", "reconnecting", "starting"].includes(status.cloud)
        ? "amber"
        : "red";
  const serverState =
    status.cloud === "connected"
      ? "Authenticated"
      : status.cloud === "auth-failed"
        ? "Authentication failed"
        : `${status.cloud.charAt(0).toUpperCase()}${status.cloud.slice(1)}`;
  const appLevel: "red" | "amber" | "green" = status.localAppRegistered
    ? "green"
    : status.localAppConnected
      ? "amber"
      : "red";
  const appState = status.localAppRegistered
    ? "Registered"
    : status.localAppConnected
      ? "Awaiting SDK hello"
    : status.localTransport === "error"
      ? "Port error"
      : "No app connected";
  const systemLevel: "red" | "amber" | "green" =
    serverLevel === "red" || status.localTransport === "error"
      ? "red"
      : serverLevel === "green" && status.localAppRegistered && status.triggersRegistered
        ? "green"
        : "amber";
  const systemState = systemLevel === "green"
    ? "Live"
    : systemLevel === "red"
      ? status.localTransport === "error" ? "Local transport error" : "Unavailable"
      : status.localAppRegistered && !status.triggersRegistered
        ? "Registering triggers"
        : "Waiting for app";
  return (
    <main className="shell">
      <div className="custom-titlebar" aria-hidden="true">
        <span>ARC Client</span>
      </div>
      <aside className="sidebar">
        <div
          className={`brand ${brandLogo ? "has-logo" : ""} ${logoOnly ? "logo-only" : ""}`}
        >
          {brandLogo ? (
            <img src={brandLogo} alt={brandName} />
          ) : (
            <span className="brand-mark">A</span>
          )}
          {!logoOnly && (
            <span>
              {brandName}
              <small>ARC Client</small>
            </span>
          )}
        </div>
        <nav>
          {pages.map((item) => (
            <button
              className={page === item ? "active" : ""}
              key={item}
              onClick={() => setPage(item)}
            >
              <PageIcon page={item} />
              <span>{item}</span>
            </button>
          ))}
        </nav>
        <div className="device">
          <small>CLIENT ID</small>
          <strong>
            {config?.name === "ARC Satellite"
              ? "ARC Client"
              : (config?.name ?? "Initialising…")}
          </strong>
          <span>{config?.clientId.slice(0, 8).toUpperCase()}</span>
        </div>
      </aside>
      <section className="content">
        <header>
          <strong>{page}</strong>
          <div className="connection-statuses">
            <ConnectionBadge
              label="Server"
              state={serverState}
              level={serverLevel}
            />
            <ConnectionBadge
              label="App"
              state={appState}
              level={appLevel}
            />
            <ConnectionBadge
              label="System"
              state={systemState}
              level={systemLevel}
            />
          </div>
        </header>
        <div className={`page ${page === "Activity Log" ? "activity-page" : ""}`}>
          {body}
        </div>
      </section>
      {launchPending && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Application Launch</h2>
            <p>
              The configured application will launch in{" "}
              <strong>{launchSecondsRemaining}</strong>{" "}
              {launchSecondsRemaining === 1 ? "second" : "seconds"}.
            </p>
            <button
              onClick={() =>
                void window.arcSatellite
                  .cancelLaunch()
                  .then(() => setLaunchPending(undefined))
              }
            >
              Cancel Launch
            </button>
          </div>
        </div>
      )}
      {portConflict && (
        <div className="modal-backdrop">
          <section className="modal port-recovery-modal" role="alertdialog" aria-modal="true">
            <div className="warning-mark">!</div>
            <h2>Local WebSocket Port Is In Use</h2>
            <p>
              ARC Client cannot listen on reserved port <strong>{portConflict.port}</strong>{" "}
              because another process is holding it.
            </p>
            <div className="process-detail">
              <span>Process</span><strong>{portConflict.command}</strong>
              <span>PID</span><code>{portConflict.pid}</code>
              {portConflict.user && <><span>User</span><strong>{portConflict.user}</strong></>}
            </div>
            <p className="warning-copy">
              Confirming will terminate this process and restart the ARC Client WebSocket listener.
              Unsaved work in that process may be lost.
            </p>
            {portRecoveryError && <p className="recovery-error">{portRecoveryError}</p>}
            <div className="actions">
              <button
                disabled={recoveringPort}
                onClick={() => {
                  setDismissedConflict(`${portConflict.port}:${portConflict.pid}`);
                  setPortConflict(undefined);
                }}
              >
                Cancel
              </button>
              <button
                className="danger"
                disabled={recoveringPort}
                onClick={() => {
                  setRecoveringPort(true);
                  setPortRecoveryError(undefined);
                  void window.arcSatellite.recoverPort(portConflict.pid)
                    .then(() => setPortConflict(undefined))
                    .catch((error) => setPortRecoveryError(error instanceof Error ? error.message : String(error)))
                    .finally(() => setRecoveringPort(false));
                }}
              >
                {recoveringPort ? "Recovering…" : "Kill Process & Restart Port"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get("view") === "splash" ? (
      <SplashScreen />
    ) : new URLSearchParams(window.location.search).get("view") === "console" ? (
      <ConsoleWindow />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
