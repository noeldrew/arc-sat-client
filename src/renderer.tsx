import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const pages = ["Overview", "Trigger Events", "Activity Log", "Settings", "App Launcher", "System Monitor"];

function App(): React.JSX.Element {
  const [status, setStatus] = useState<import("./core/events").SatelliteStatus>({ cloud: "stopped", localTransport: "stopped", localAppConnected: false });
  useEffect(() => {
    void window.arcSatellite.getStatus().then(setStatus);
    return window.arcSatellite.onStatus(setStatus);
  }, []);
  const allGood = status.cloud === "connected" && status.localAppConnected;
  const statusText = status.cloud === "auth-failed" ? "Authentication Failed" : allGood ? "All Systems Go" : status.localTransport === "error" ? "Local Port Error" : "App Not Connected";
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">A</span><span>ARC Satellite</span></div>
        <nav>{pages.map((page, index) => <button className={index === 0 ? "active" : ""} key={page}>{page}</button>)}</nav>
        <div className="device"><small>DEVICE</small><strong>Initialising…</strong></div>
      </aside>
      <section className="content">
        <header><strong>Overview</strong><span className={`status ${allGood ? "good" : ""}`}>● {statusText}</span></header>
        <div className="page">
          <div className="headline"><div><h1>Satellite overview</h1><p>Live connectivity, sessions and local transport health.</p></div></div>
          <div className="cards">
            <article><small>ARC SERVER</small><strong>{status.cloud}</strong><span>Authenticated cloud WebSocket</span></article>
            <article><small>LOCAL APP</small><strong>{status.localAppConnected ? "Connected" : "Not connected"}</strong><span>{status.transportError ?? "WebSocket · localhost:25585"}</span></article>
            <article><small>ACTIVE SESSION</small><strong>{status.cloudSessionId ? status.cloudSessionId.slice(0, 8) : "None"}</strong><span>Ready for an RFID interaction</span></article>
          </div>
          <article className="panel"><h2>Satellite core</h2><p>The ARC cloud and localhost application connections run independently of this sandboxed interface, with explicit transport state and validated protocol messages.</p></article>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
