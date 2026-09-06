'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Header } from '@/components/layout/Header';
import { TabNav } from '@/components/layout/TabNav';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Guard: unauthenticated users → login
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner size={40} />
      </div>
    );
  }

  // Prevent flash of content for unauthenticated state
  if (!user) return null;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <TabNav />
      <main className="flex-1 px-4 sm:px-6 py-6 max-w-7xl mx-auto w-full">
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </main>
    </div>
  );
}

