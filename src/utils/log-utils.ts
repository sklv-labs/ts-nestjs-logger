import { BaseError } from '@sklv-labs/ts-nestjs-error';

import { INVALID_CONTEXT_VALUES, SENSITIVE_KEYS } from '../constants/log-constants';

/**
 * Format stack trace string into array of lines
 */
export function formatStackTrace(stack: string): string[] {
  return stack
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Sanitize object by redacting sensitive keys
 */
export function sanitizeObject(
  obj: Record<string, unknown>,
  sensitiveKeys: readonly string[] = SENSITIVE_KEYS
): Record<string, unknown> {
  const sanitized = { ...obj };

  for (const key in sanitized) {
    if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Truncate data to maximum length
 * Handles circular references safely
 */
export function truncateData(data: unknown, maxLength: number): unknown {
  if (!data || typeof data !== 'object') {
    return data;
  }

  // Use a Set to track circular references
  const seen = new WeakSet();
  let hasCircularRef = false;

  // Try to stringify with circular reference detection
  let dataStr: string;
  try {
    dataStr = JSON.stringify(data, (_key: string, value: unknown) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          hasCircularRef = true;
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    });
  } catch {
    // If stringification fails, return a safe representation
    return {
      _error: 'Failed to serialize data',
      _type: typeof data,
      _constructor: (data as { constructor?: { name?: string } })?.constructor?.name || 'Unknown',
    };
  }

  if (dataStr.length <= maxLength && !hasCircularRef) {
    return data;
  }

  // If we have circular refs or need truncation, return a safe representation
  if (hasCircularRef) {
    return {
      _circular: true,
      _type: typeof data,
      _constructor: (data as { constructor?: { name?: string } })?.constructor?.name || 'Unknown',
      _preview: dataStr.substring(0, maxLength),
    };
  }

  return {
    ...(data as Record<string, unknown>),
    _truncated: true,
    _originalLength: dataStr.length,
    _preview: `${dataStr.substring(0, maxLength)}...`,
  };
}

/**
 * Type guard to check if error is a BaseError
 */
export function isBaseError(error: unknown): error is BaseError {
  return (
    error instanceof Error &&
    'code' in error &&
    'loggable' in error &&
    'setTransportIfUnset' in error &&
    typeof (error as BaseError).code === 'string' &&
    typeof (error as BaseError).loggable === 'boolean'
  );
}

/**
 * Check if a context value is valid (not an internal/invalid value)
 */
export function isValidContextValue(value: unknown, key?: string): boolean {
  // Skip context field (we use service instead)
  if (key === 'context') {
    return false;
  }

  // Check if value is in invalid values set
  if (typeof value === 'string' && INVALID_CONTEXT_VALUES.has(value)) {
    return false;
  }

  return true;
}

/**
 * Clean log data by removing invalid values
 */
export function cleanLogData(logData: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};

  Object.entries(logData).forEach(([key, value]) => {
    if (isValidContextValue(value, key)) {
      cleaned[key] = value;
    }
  });

  return cleaned;
}

/**
 * Format error cause for logging
 */
export function formatCause(cause: unknown): unknown {
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      ...(cause.stack && {
        stack: formatStackTrace(cause.stack),
      }),
    };
  }
  return cause;
}
