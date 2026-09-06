'use client';

import React from 'react';
import Image from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { SlackStatus } from '@/types';
import api from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

function SlackWidget() {
  const qc = useQueryClient();

  const { data } = useQuery<{ success: boolean; data: SlackStatus }>({
    queryKey: ['slack-status'],
    queryFn: () => api.get('/slack/status').then((r) => r.data),
    staleTime: 30_000,
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api.delete('/slack/disconnect'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['slack-status'] }),
  });

  const slackStatus = data?.data;

  if (!slackStatus) return null;

  if (slackStatus.connected) {
    return (
      <div className="hidden md:flex items-center gap-2 text-sm">
        {/* Slack icon */}
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 54 54" aria-hidden="true">
          <path fill="#E01E5A" d="M19.712.133a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386h5.376V5.52A5.381 5.381 0 0 0 19.712.133m0 14.365H5.376A5.381 5.381 0 0 0 0 19.884a5.381 5.381 0 0 0 5.376 5.386h14.336a5.381 5.381 0 0 0 5.376-5.386 5.381 5.381 0 0 0-5.376-5.386"/>
          <path fill="#36C5F0" d="M53.76 19.884a5.381 5.381 0 0 0-5.376-5.386 5.381 5.381 0 0 0-5.376 5.386v5.386h5.376a5.381 5.381 0 0 0 5.376-5.386m-14.336 0V5.52A5.381 5.381 0 0 0 34.048.133a5.381 5.381 0 0 0-5.376 5.387v14.364a5.381 5.381 0 0 0 5.376 5.386 5.381 5.381 0 0 0 5.376-5.386"/>
          <path fill="#2EB67D" d="M34.048 54a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386h-5.376v5.386A5.381 5.381 0 0 0 34.048 54m0-14.365h14.336a5.381 5.381 0 0 0 5.376-5.386 5.381 5.381 0 0 0-5.376-5.386H34.048a5.381 5.381 0 0 0-5.376 5.386 5.381 5.381 0 0 0 5.376 5.386"/>
          <path fill="#ECB22E" d="M0 34.249a5.381 5.381 0 0 0 5.376 5.386 5.381 5.381 0 0 0 5.376-5.386v-5.386H5.376A5.381 5.381 0 0 0 0 34.249m14.336 0v14.364A5.381 5.381 0 0 0 19.712 54a5.381 5.381 0 0 0 5.376-5.387V34.249a5.381 5.381 0 0 0-5.376-5.386 5.381 5.381 0 0 0-5.376 5.386"/>
        </svg>
        <span className="text-green-700 font-medium truncate max-w-[120px]">
          {slackStatus.teamName ?? 'Slack connected'}
        </span>
        <button
          onClick={() => disconnectMutation.mutate()}
          disabled={disconnectMutation.isPending}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors underline underline-offset-2"
          aria-label="Disconnect Slack"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <a
      href={`${API_URL}/slack/connect`}
      className="hidden md:inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors border border-gray-200 rounded-lg px-3 py-1.5 hover:border-gray-300 hover:bg-gray-50"
      aria-label="Connect Slack notifications"
    >
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 54 54" aria-hidden="true">
        <path fill="#E01E5A" d="M19.712.133a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386h5.376V5.52A5.381 5.381 0 0 0 19.712.133m0 14.365H5.376A5.381 5.381 0 0 0 0 19.884a5.381 5.381 0 0 0 5.376 5.386h14.336a5.381 5.381 0 0 0 5.376-5.386 5.381 5.381 0 0 0-5.376-5.386"/>
        <path fill="#36C5F0" d="M53.76 19.884a5.381 5.381 0 0 0-5.376-5.386 5.381 5.381 0 0 0-5.376 5.386v5.386h5.376a5.381 5.381 0 0 0 5.376-5.386m-14.336 0V5.52A5.381 5.381 0 0 0 34.048.133a5.381 5.381 0 0 0-5.376 5.387v14.364a5.381 5.381 0 0 0 5.376 5.386 5.381 5.381 0 0 0 5.376-5.386"/>
        <path fill="#2EB67D" d="M34.048 54a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386h-5.376v5.386A5.381 5.381 0 0 0 34.048 54m0-14.365h14.336a5.381 5.381 0 0 0 5.376-5.386 5.381 5.381 0 0 0-5.376-5.386H34.048a5.381 5.381 0 0 0-5.376 5.386 5.381 5.381 0 0 0 5.376 5.386"/>
        <path fill="#ECB22E" d="M0 34.249a5.381 5.381 0 0 0 5.376 5.386 5.381 5.381 0 0 0 5.376-5.386v-5.386H5.376A5.381 5.381 0 0 0 0 34.249m14.336 0v14.364A5.381 5.381 0 0 0 19.712 54a5.381 5.381 0 0 0 5.376-5.387V34.249a5.381 5.381 0 0 0-5.376-5.386 5.381 5.381 0 0 0-5.376 5.386"/>
      </svg>
      Connect Slack
    </a>
  );
}

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 flex items-center justify-between flex-shrink-0 gap-3">
      {/* Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <Image
          src="/logo.png"
          alt="ReachInbox logo"
          width={32}
          height={32}
          className="rounded-lg"
          priority
        />
        <span className="font-semibold text-gray-900 text-lg hidden xs:block">ReachInbox</span>
      </div>

      {/* Center — Slack widget */}
      <div className="flex-1 flex justify-center">
        <SlackWidget />
      </div>

      {/* Right — User info + logout */}
      {user && (
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            {user.avatarUrl ? (
              <Image
                src={user.avatarUrl}
                alt={user.name}
                width={34}
                height={34}
                className="rounded-full ring-2 ring-gray-100"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold text-sm">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-gray-900 leading-tight">{user.name}</p>
              <p className="text-xs text-gray-500 leading-tight truncate max-w-[150px]">{user.email}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={logout} aria-label="Log out">
            <span className="hidden sm:inline">Logout</span>
            <svg className="sm:hidden w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </Button>
        </div>
      )}
    </header>
  );
}
