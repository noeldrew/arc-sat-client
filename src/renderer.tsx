import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const pages = ["Overview", "Trigger Events", "Activity Log", "Settings", "App Launcher", "System Monitor"];

function App(): React.JSX.Element {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">A</span><span>ARC Satellite</span></div>
        <nav>{pages.map((page, index) => <button className={index === 0 ? "active" : ""} key={page}>{page}</button>)}</nav>
        <div className="device"><small>DEVICE</small><strong>Initialising…</strong></div>
      </aside>
      <section className="content">
        <header><strong>Overview</strong><span className="status">● App Not Connected</span></header>
        <div className="page">
          <div className="headline"><div><h1>Satellite overview</h1><p>Live connectivity, sessions and local transport health.</p></div></div>
          <div className="cards">
            <article><small>ARC SERVER</small><strong>Initialising</strong><span>Awaiting connection service</span></article>
            <article><small>LOCAL APP</small><strong>Not connected</strong><span>WebSocket · localhost:25585</span></article>
            <article><small>ACTIVE SESSION</small><strong>None</strong><span>Ready for an RFID interaction</span></article>
          </div>
          <article className="panel"><h2>Compatibility foundation</h2><p>The Electron shell is running with an isolated renderer. ARC and local-app protocol services are being implemented as independent, tested modules.</p></article>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
