'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { EmailTable, TableSkeleton } from '@/components/emails/EmailTable';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ComposeModal } from '@/components/compose/ComposeModal';
import api from '@/lib/api';
import { PaginatedResponse, EmailJob, SenderAccount } from '@/types';

export default function ScheduledEmailsPage() {
  const [page, setPage]             = useState(1);
  const [composeOpen, setComposeOpen] = useState(false);

  // Fetch scheduled emails — auto-refresh every 10 seconds
  const { data, isLoading, refetch } = useQuery<PaginatedResponse<EmailJob & { subject: string }>>({
    queryKey: ['emails', 'scheduled', page],
    queryFn: async () => {
      const res = await api.get(`/api/emails/scheduled?page=${page}&limit=20`);
      return res.data;
    },
    refetchInterval: 10_000,
  });

  // Fetch sender accounts for compose modal
  const { data: sendersRes } = useQuery<{ success: boolean; data: SenderAccount[] }>({
    queryKey: ['senders'],
    queryFn: async () => {
      const res = await api.get('/api/senders');
      return res.data;
    },
  });

  const senders = sendersRes?.data ?? [];
  const emails  = data?.data ?? [];

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Scheduled Emails</h1>
          {!isLoading && (
            <p className="text-sm text-gray-500 mt-0.5">
              {data?.total ?? 0} total
            </p>
          )}
        </div>
        <Button onClick={() => setComposeOpen(true)}>
          + Compose New Email
        </Button>
      </div>

      {/* Content */}
      {isLoading ? (
        <TableSkeleton rows={6} />
      ) : emails.length === 0 ? (
        <EmptyState
          title="No scheduled emails"
          description="Compose a new campaign to get started."
          icon={
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          }
          action={
            <Button onClick={() => setComposeOpen(true)}>Compose New Email</Button>
          }
        />
      ) : (
        <>
          <EmailTable emails={emails} mode="scheduled" />
          <Pagination
            page={page}
            totalPages={data?.totalPages ?? 1}
            total={data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}

      {/* Compose Modal */}
      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        senders={senders}
        onSuccess={() => { refetch(); setPage(1); }}
      />
    </div>
  );
}
