'use client';

import React from 'react';
import { EmailJob, EmailJobStatus } from '@/types';
import { StatusBadge } from '@/components/ui/Badge';

interface EmailTableProps {
  emails: (EmailJob & { subject?: string })[];
  mode: 'scheduled' | 'sent';
}

function fmt(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Shimmer skeleton for a loading table row */
function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100">
      {[1, 2, 3, 4].map((i) => (
        <td key={i} className="px-4 py-3">
          <div className="skeleton h-4 rounded w-full" />
        </td>
      ))}
    </tr>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm bg-white">
      <table className="min-w-full">
        <thead className="bg-gray-50">
          <tr>
            {['Recipient', 'Subject', 'Time', 'Status'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{Array.from({ length: rows }).map((_, i) => <SkeletonRow key={i} />)}</tbody>
      </table>
    </div>
  );
}

export function EmailTable({ emails, mode }: EmailTableProps) {
  const timeLabel = mode === 'scheduled' ? 'Scheduled At' : 'Sent At';

  return (
    <>
      {/* ── Desktop table ──────────────────────────────────────── */}
      <div className="hidden sm:block overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 bg-white">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Recipient</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Subject</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{timeLabel}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {emails.map((job) => (
              <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-gray-900 truncate max-w-[200px]">{job.recipient_email}</p>
                  {job.recipient_name && (
                    <p className="text-xs text-gray-500 truncate max-w-[200px]">{job.recipient_name}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate">{job.subject ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                  {fmt(mode === 'scheduled' ? job.scheduled_at : job.sent_at)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={job.status as EmailJobStatus} />
                  {job.error_message && (
                    <p className="text-xs text-red-500 mt-1 max-w-[200px] truncate" title={job.error_message}>
                      {job.error_message}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile stacked cards ───────────────────────────────── */}
      <div className="sm:hidden space-y-3">
        {emails.map((job) => (
          <div key={job.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{job.recipient_email}</p>
                {job.recipient_name && (
                  <p className="text-xs text-gray-500 truncate">{job.recipient_name}</p>
                )}
              </div>
              <StatusBadge status={job.status as EmailJobStatus} />
            </div>
            {job.subject && (
              <p className="text-sm text-gray-700 mb-1 line-clamp-2">{job.subject}</p>
            )}
            <p className="text-xs text-gray-400">
              {timeLabel}: {fmt(mode === 'scheduled' ? job.scheduled_at : job.sent_at)}
            </p>
            {job.error_message && (
              <p className="text-xs text-red-500 mt-1 truncate">{job.error_message}</p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
