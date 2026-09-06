import React from 'react';
import { clsx } from 'clsx';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed',
        {
          'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500':           variant === 'primary',
          'bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-400':        variant === 'secondary',
          'bg-red-600  text-white hover:bg-red-700  focus:ring-red-500':            variant === 'danger',
          'bg-transparent text-gray-700 hover:bg-gray-100 focus:ring-gray-400':     variant === 'ghost',
          'px-3 py-1.5 text-sm': size === 'sm',
          'px-4 py-2   text-sm': size === 'md',
          'px-6 py-3   text-base': size === 'lg',
        },
        className
      )}
      {...props}
    >
      {loading && (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
