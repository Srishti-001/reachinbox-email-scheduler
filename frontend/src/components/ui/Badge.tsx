import React from 'react';
import { clsx } from 'clsx';
import { EmailJobStatus } from '@/types';

const statusConfig: Record<EmailJobStatus, { label: string; classes: string }> = {
  scheduled:    { label: 'Scheduled',    classes: 'bg-blue-100   text-blue-800'   },
  queued:       { label: 'Queued',       classes: 'bg-yellow-100 text-yellow-800' },
  sending:      { label: 'Sending',      classes: 'bg-purple-100 text-purple-800' },
  sent:         { label: 'Sent',         classes: 'bg-green-100  text-green-800'  },
  failed:       { label: 'Failed',       classes: 'bg-red-100    text-red-800'    },
  rate_limited: { label: 'Rate Limited', classes: 'bg-orange-100 text-orange-800' },
};

interface StatusBadgeProps {
  status: EmailJobStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const cfg = statusConfig[status] ?? { label: status, classes: 'bg-gray-100 text-gray-800' };
  return (
    <span className={clsx('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', cfg.classes)}>
      {cfg.label}
    </span>
  );
}
