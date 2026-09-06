'use client';

import React from 'react';
import { Button } from './Button';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, total, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between mt-4 px-1">
      <p className="text-sm text-gray-500">
        Page <span className="font-medium">{page}</span> of{' '}
        <span className="font-medium">{totalPages}</span>{' '}
        <span className="text-gray-400">({total} total)</span>
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          ← Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next →
        </Button>
      </div>
    </div>
  );
}
