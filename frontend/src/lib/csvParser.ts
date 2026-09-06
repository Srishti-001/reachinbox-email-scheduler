import Papa from 'papaparse';
import { Lead } from '@/types';

export interface ParseResult {
  leads: Lead[];
  count: number;
  errors: string[];
}

/**
 * Parses a CSV file client-side.
 * Expected columns (case-insensitive): email (required), name (optional).
 * Returns deduplicated, validated leads and any parse errors.
 */
export function parseCSVFile(file: File): Promise<ParseResult> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (results) => {
        const errors: string[] = results.errors.map(
          (e) => `Row ${e.row}: ${e.message}`
        );

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const seen = new Set<string>();
        const leads: Lead[] = [];

        for (const row of results.data) {
          const email = row['email']?.trim().toLowerCase();
          if (!email || !emailRegex.test(email)) continue;
          if (seen.has(email)) continue;
          seen.add(email);
          leads.push({ email, name: row['name']?.trim() || undefined });
        }

        resolve({ leads, count: leads.length, errors });
      },
      error: (err) => {
        resolve({ leads: [], count: 0, errors: [err.message] });
      },
    });
  });
}
