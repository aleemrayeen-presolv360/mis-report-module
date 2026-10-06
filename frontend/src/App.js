/**
 * Standalone shell for running the Report module locally — sidebar and header copied from
 * litelo-reports-v2.html. In the Litelo platform only <MISReport /> is used; the platform
 * already has its own sidebar and header.
 */

import React, { useEffect, useState } from 'react';
import MISReport from './components/mis/MISReport';
import { misApi } from './services/mis-api';

const NAV = [
  { label: 'Dashboard', icon: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></> },
  { label: 'Cheque Bounce', icon: <path d="M12 3v18M7 21h10M5 7h14M5 7 2 14h6L5 7Zm14 0-3 7h6l-3-7Z" /> },
  { label: 'EFT Dishonour', icon: <path d="M3 21h18M4 10v8M9 10v8M15 10v8M20 10v8M12 3 3 8h18l-9-5Z" /> },
  { label: 'Case Tracker', icon: <path d="m14 9-5 5m-3-8 6 6M4 20h9M8.5 3.5l6 6M17 12l4 4-2 2-4-4" /> },
  { label: 'Report', icon: <path d="M5 3h9l5 5v13H5V3Zm9 0v5h5M9 13h6M9 17h6" />, current: true },
];

function toggleTheme() {
  const root = document.documentElement;
  const current = root.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
}

export default function App() {
  const [user, setUser] = useState({ email: '', name: '' });

  useEffect(() => {
    misApi.getConfig().then((config) => setUser(config.user)).catch(() => {});
  }, []);

  // "Aleem Rayeen" -> "AR"
  const displayName = user.name || user.email.split('@')[0];
  const initials = displayName.split(/[\s.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M3 15.5 11 3h5.5L8.5 15.5H3Z" fill="#c9a227" />
            <path d="M8 21 16 8.5h5.5L13.5 21H8Z" fill="currentColor" />
          </svg>
          Litelo
        </div>
        {NAV.map((item) => (
          <button key={item.label} className="nav" aria-current={item.current ? 'page' : undefined}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {item.icon}
            </svg>
            {item.label}
          </button>
        ))}
      </aside>

      <div className="col">
        <header className="top">
          <div className="ti">
            <button className="iconbtn" aria-label="Toggle theme" onClick={toggleTheme}>◐</button>
            <div className="who">
              <div className="av">{initials}</div>
              <div><p>{displayName}</p><small>{user.email}</small></div>
            </div>
          </div>
        </header>
        <div className="content">
          <MISReport />
        </div>
      </div>
    </div>
  );
}
