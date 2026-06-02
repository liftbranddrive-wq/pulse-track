import React from 'react';
import { Plug } from 'lucide-react';

export default function IntegrationGHL() {
  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-brand/15 flex items-center justify-center ring-1 ring-brand/30">
          <Plug className="w-5 h-5 text-brand" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">GoHighLevel</h1>
          <p className="text-sm text-muted">Integration scaffold</p>
        </div>
      </div>
      <div className="rounded-xl2 border border-line bg-surface shadow-soft p-6 text-[14px] text-muted leading-relaxed space-y-3">
        <p>
          A full Production GoHighLevel link (contacts, pipelines, webhook automations from PulseTrack alerts) wasn’t 
          wired in this open-source bundle — APIs & pricing change per workspace.
        </p>
        <p className="text-ink font-medium">
          What you typically need next (share this with whoever deploys PulseTrack):
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>GHL SaaS/private location URL + OAuth or API keys your org approves.</li>
          <li>Which PulseTrack events should sync (new flag, absentee, ghost spike, weekly digest).</li>
          <li>Where mirrored data should appear (contacts, pipelines, Slack bridge, SMS, etc.).</li>
        </ul>
        <p>
          Backend hook points live around <code className="text-[12px] bg-page px-1.5 py-0.5 rounded border border-line">admin.routes.js</code> flag creation & cron jobs — Cursor can bolt on outbound webhooks safely once credentials exist.
        </p>
      </div>
    </div>
  );
}
