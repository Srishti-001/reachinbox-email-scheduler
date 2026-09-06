'use client';

import React, { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Lead, SenderAccount, ComposeFormValues } from '@/types';
import { parseCSVFile } from '@/lib/csvParser';
import api from '@/lib/api';

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
  senders: SenderAccount[];
  onSuccess: () => void;
}

export function ComposeModal({ open, onClose, senders, onSuccess }: ComposeModalProps) {
  const [leads, setLeads]         = useState<Lead[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ComposeFormValues>({
    defaultValues: { delayBetweenMs: 1000, hourlyLimit: 50 },
  });

  const handleCSVChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await parseCSVFile(file);
    setLeads(result.leads);
    setCsvErrors(result.errors);
    if (result.count === 0) toast.error('No valid emails found in the CSV');
  }, []);

  const handleClose = () => {
    reset();
    setLeads([]);
    setCsvErrors([]);
    onClose();
  };

  const onSubmit = async (data: ComposeFormValues) => {
    if (leads.length === 0) {
      toast.error('Please upload a CSV with at least one valid email address');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/campaigns', {
        senderAccountId: data.senderAccountId,
        subject:         data.subject,
        body:            data.body,
        recipients:      leads,
        scheduledStart:  new Date(data.scheduledStart).toISOString(),
        delayBetweenMs:  Number(data.delayBetweenMs),
        hourlyLimit:     Number(data.hourlyLimit),
      });
      toast.success(`Campaign scheduled for ${leads.length} recipient(s)!`);
      reset();
      setLeads([]);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to schedule campaign');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Compose New Email Campaign" size="lg">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

        {/* Sender */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Sender Account</label>
          <select
            {...register('senderAccountId', { required: 'Please select a sender' })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select sender…</option>
            {senders.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name} &lt;{s.email}&gt;
              </option>
            ))}
          </select>
          {errors.senderAccountId && (
            <p className="text-xs text-red-600">{errors.senderAccountId.message}</p>
          )}
          {senders.length === 0 && (
            <p className="text-xs text-amber-600">
              No senders configured. Add one via the API first.
            </p>
          )}
        </div>

        {/* Subject */}
        <Input
          label="Subject"
          placeholder="Your email subject"
          {...register('subject', { required: 'Subject is required' })}
          error={errors.subject?.message}
        />

        {/* Body */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Body</label>
          <textarea
            rows={5}
            placeholder="Write your email body here…"
            {...register('body', { required: 'Body is required' })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.body && <p className="text-xs text-red-600">{errors.body.message}</p>}
        </div>

        {/* CSV Upload */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Leads (CSV)</label>
          <label
            htmlFor="csv-upload"
            className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-5 cursor-pointer hover:border-blue-400 transition-colors"
          >
            <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <input id="csv-upload" type="file" accept=".csv" className="hidden" onChange={handleCSVChange} />
            <p className="text-sm text-center text-gray-500">
              {leads.length > 0 ? (
                <span className="text-green-700 font-semibold">{leads.length} valid email(s) detected</span>
              ) : (
                <>Click to upload CSV<br /><span className="text-xs text-gray-400">Columns: email (required), name (optional)</span></>
              )}
            </p>
          </label>

          {/* Preview */}
          {leads.length > 0 && (
            <div className="text-xs bg-gray-50 rounded-lg p-3 text-gray-600 border border-gray-100">
              <strong>Preview:</strong>{' '}
              {leads.slice(0, 5).map((l) => l.email).join(', ')}
              {leads.length > 5 && ` … +${leads.length - 5} more`}
            </div>
          )}

          {csvErrors.length > 0 && (
            <p className="text-xs text-red-600">{csvErrors[0]}</p>
          )}
        </div>

        {/* Schedule Settings */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Start Time</label>
            <input
              type="datetime-local"
              {...register('scheduledStart', { required: 'Start time is required' })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.scheduledStart && (
              <p className="text-xs text-red-600">{errors.scheduledStart.message}</p>
            )}
          </div>

          <Input
            label="Delay Between Sends (ms)"
            type="number"
            min={0}
            {...register('delayBetweenMs', { required: true, min: 0, valueAsNumber: true })}
            error={errors.delayBetweenMs ? 'Must be ≥ 0' : undefined}
          />

          <Input
            label="Hourly Limit"
            type="number"
            min={1}
            {...register('hourlyLimit', { required: true, min: 1, valueAsNumber: true })}
            error={errors.hourlyLimit ? 'Must be ≥ 1' : undefined}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2 border-t">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Schedule Campaign
          </Button>
        </div>
      </form>
    </Modal>
  );
}
