'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';

const tabs = [
  { label: 'Scheduled Emails', href: '/dashboard/scheduled' },
  { label: 'Sent Emails',      href: '/dashboard/sent'      },
];

export function TabNav() {
  const pathname = usePathname();

  return (
    <nav className="bg-white border-b border-gray-200 px-6 flex-shrink-0">
      <div className="flex">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={clsx(
              'px-5 py-3 text-sm font-medium border-b-2 transition-colors',
              pathname === tab.href
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
