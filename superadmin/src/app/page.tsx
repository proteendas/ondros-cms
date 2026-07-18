'use client';

/** Platform overview (spec 013): headline totals + 30-day signup chart. */
import { useEffect, useState } from 'react';

import Shell from '@/components/Shell';
import { api, fmtNum } from '@/lib/api';

interface Overview {
  accounts: number;
  users_total: number;
  users_active: number;
  spaces: number;
  entries: number;
  api_calls_this_month: number;
  signups_last_30_days: { date: string; count: number }[];
}

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Overview>('/platform/overview').then(setData).catch((e) => setError(String(e.message)));
  }, []);

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>Platform-wide totals across every account.</p>
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      {data && (
        <>
          <div className="cards">
            <Stat k="Accounts" v={fmtNum(data.accounts)} />
            <Stat k="Users" v={fmtNum(data.users_total)} hint={`${fmtNum(data.users_active)} active`} />
            <Stat k="Spaces" v={fmtNum(data.spaces)} />
            <Stat k="Entries" v={fmtNum(data.entries)} />
            <Stat k="API calls (this month)" v={fmtNum(data.api_calls_this_month)} />
          </div>
          <div className="panel">
            <h2>Signups — last 30 days</h2>
            <SignupChart points={data.signups_last_30_days} />
          </div>
        </>
      )}
    </Shell>
  );
}

function Stat({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="card">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function SignupChart({ points }: { points: { date: string; count: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  return (
    <>
      <div className="chart-bars">
        {points.map((p) => (
          <div
            key={p.date}
            className="bar"
            style={{ height: `${Math.max(2, (p.count / max) * 100)}%` }}
            title={`${p.date}: ${p.count} signup${p.count === 1 ? '' : 's'}`}
          />
        ))}
      </div>
      <div className="chart-x">
        <span>{points[0]?.date}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </>
  );
}
