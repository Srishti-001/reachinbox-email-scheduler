'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmailTable, TableSkeleton } from '@/components/emails/EmailTable';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import api from '@/lib/api';
import { PaginatedResponse, EmailJob } from '@/types';

// ─── Debounce hook ─────────────────────────────────────────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ─── Search result type (matches ES hit shape from backend) ───────────────────
interface SearchHit {
  emailJobId: string;
  campaignId: string;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  errorMessage: string | null;
}

interface SearchResponse {
  success: boolean;
  data: SearchHit[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Adapt ES hits to the EmailJob shape EmailTable expects
function hitToEmailJob(h: SearchHit): EmailJob & { subject: string } {
  return {
    id:              h.emailJobId,
    campaign_id:     h.campaignId,
    recipient_email: h.recipientEmail,
    recipient_name:  h.recipientName,
    subject:         h.subject,
    scheduled_at:    h.scheduledAt,
    sent_at:         h.sentAt,
    status:          h.status as any,
    error_message:   h.errorMessage,
  };
}

export default function SentEmailsPage() {
  const [page, setPage]     = useState(1);
  const [query, setQuery]   = useState('');
  const debouncedQ          = useDebounce(query, 350);
  const isSearching         = debouncedQ.trim().length > 0;

  // Reset page when search query changes
  useEffect(() => { setPage(1); }, [debouncedQ]);

  // ── Standard paginated list (shown when no search query) ────────────────────
  const listQuery = useQuery<PaginatedResponse<EmailJob & { subject: string }>>({
    queryKey: ['emails', 'sent', page],
    queryFn: async () => {
      const res = await api.get(`/api/emails/sent?page=${page}&limit=20`);
      return res.data;
    },
    refetchInterval: 15_000,
    enabled: !isSearching,
  });

  // ── Elasticsearch search (shown when query is non-empty) ────────────────────
  const searchQuery = useQuery<SearchResponse>({
    queryKey: ['emails', 'search', debouncedQ, page],
    queryFn: async () => {
      const res = await api.get(
        `/api/emails/search?q=${encodeURIComponent(debouncedQ)}&page=${page}&limit=20`
      );
      return res.data;
    },
    enabled: isSearching,
  });

  // Decide which data source to render
  const loading    = isSearching ? searchQuery.isLoading : listQuery.isLoading;
  const total      = isSearching ? (searchQuery.data?.total ?? 0) : (listQuery.data?.total ?? 0);
  const totalPages = isSearching ? (searchQuery.data?.totalPages ?? 1) : (listQuery.data?.totalPages ?? 1);

  const emails: (EmailJob & { subject: string })[] = isSearching
    ? (searchQuery.data?.data ?? []).map(hitToEmailJob)
    : (listQuery.data?.data ?? []);

  return (
    <div>
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Sent Emails</h1>
          {!loading && (
            <p className="text-sm text-gray-500 mt-0.5">
              {isSearching
                ? `${total} result${total !== 1 ? 's' : ''} for "${debouncedQ}"`
                : `${total} total`}
            </p>
          )}
        </div>

        {/* Search input */}
        <div className="relative w-full sm:w-72">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none" aria-hidden="true">
            {searchQuery.isFetching && isSearching ? (
              <Spinner size={14} />
            ) : (
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email, subject, status…"
            aria-label="Search sent emails"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white transition-shadow"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute inset-y-0 right-2 flex items-center px-1 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Clear search"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* aria-live region so screen readers announce result changes */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {!loading && isSearching && `${total} results found for ${debouncedQ}`}
      </div>

      {/* Content */}
      {loading ? (
        <TableSkeleton rows={6} />
      ) : emails.length === 0 ? (
        <EmptyState
          title={isSearching ? 'No results found' : 'No sent emails yet'}
          description={
            isSearching
              ? `No emails match "${debouncedQ}". Try a different search term.`
              : 'Sent emails will appear here once campaigns start processing.'
          }
          icon={
            isSearching ? (
              <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            ) : (
              <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )
          }
          action={
            isSearching ? (
              <button
                onClick={() => setQuery('')}
                className="text-sm text-blue-600 hover:underline"
              >
                Clear search
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <EmailTable emails={emails} mode="sent" />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
