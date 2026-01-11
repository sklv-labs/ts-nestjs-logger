import { readFileSync } from 'fs';
import * as os from 'os';
import { join } from 'path';

import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { Environments, getAppVersion } from '@sklv-labs/ts-core';
import pino, { Logger as PinoLogger, LoggerOptions } from 'pino';

import {
  DEFAULT_REDACT_PATHS,
  INTERNAL_CLASSES,
  INTERNAL_METHODS,
} from '../constants/log-constants';
import {
  cleanLogData,
  formatCause,
  formatStackTrace,
  isValidContextValue,
} from '../utils/log-utils';

import { getCallerContext, getInfrastructureContext, LoggerContextService } from './logger.context';

// Cache OpenTelemetry API at module level to avoid repeated require() calls
let cachedOtelTrace: {
  getActiveSpan: () => { spanContext: () => { traceId?: string; spanId?: string } } | null;
} | null = null;

function getOtelTrace(): typeof cachedOtelTrace {
  if (cachedOtelTrace !== null) {
    return cachedOtelTrace;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { trace } = require('@opentelemetry/api') as {
      trace: {
        getActiveSpan: () => { spanContext: () => { traceId?: string; spanId?: string } } | null;
      } | null;
    };
    cachedOtelTrace = trace || null;
    return cachedOtelTrace;
  } catch {
    // OpenTelemetry not available, cache null to avoid retrying
    cachedOtelTrace = null;
    return null;
  }
}

export interface LoggerModuleOptions {
  /**
   * Environment name (development, production, test)
   */
  environment?: Environments;
  /**
   * Application name for log context
   */
  appName?: string;
  /**
   * Log level (trace, debug, info, warn, error, fatal)
   * @default 'info' in production, 'debug' in development
   */
  level?: string;
  /**
   * Enable pretty printing (useful for development)
   * @default true in development, false in production
   */
  prettyPrint?: boolean;
  /**
   * Additional Pino options
   */
  pinoOptions?: Partial<LoggerOptions>;
  /**
   * Redact sensitive fields from logs
   */
  redact?: string[];
  /**
   * Service version (defaults to package.json version)
   */
  serviceVersion?: string;
}

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: PinoLogger;
  private readonly context?: string;
  private readonly infrastructureContext: Record<string, unknown>;
  private readonly packageVersion: string;

  constructor(
    private readonly options: LoggerModuleOptions = {},
    private readonly loggerContextService?: LoggerContextService,
    context?: string
  ) {
    this.context = context;
    // Initialize package version during construction (not on first log call)
    this.packageVersion = this.initializePackageVersion();
    this.infrastructureContext = this.buildInfrastructureContext();
    this.logger = this.createLogger();
  }

  /**
   * Initialize package version during construction to avoid blocking during request handling
   */
  private initializePackageVersion(): string {
    // Use serviceVersion from options if provided
    if (this.options.serviceVersion) {
      return this.options.serviceVersion;
    }

    // Try to read from package.json during initialization
    try {
      const packagePath = join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8')) as { version?: string };
      return packageJson.version || getAppVersion() || 'unknown';
    } catch {
      // Fallback to getAppVersion if package.json read fails
      return getAppVersion() || 'unknown';
    }
  }

  /**
   * Get package version (cached during construction)
   */
  private getPackageVersion(): string {
    return this.packageVersion || 'unknown';
  }

  private buildInfrastructureContext(): Record<string, unknown> {
    const infra = getInfrastructureContext();
    const baseContext: Record<string, unknown> = {
      env:
        this.options.environment ||
        (process.env.NODE_ENV as Environments) ||
        Environments.DEVELOPMENT,
      app: this.options.appName || process.env.APP_NAME || 'nestjs-app',
      pid: process.pid,
      hostname: os.hostname(),
      version: this.getPackageVersion(),
    };

    // Merge with infrastructure context
    return { ...baseContext, ...infra };
  }

  private createLogger(): PinoLogger {
    const {
      environment = (process.env.NODE_ENV as Environments) || Environments.DEVELOPMENT,
      level,
      prettyPrint,
      pinoOptions = {},
      redact = [...DEFAULT_REDACT_PATHS],
    } = this.options;

    const isDevelopment = environment === Environments.DEVELOPMENT;
    const isTest = environment === Environments.TEST;

    const defaultOptions: LoggerOptions = {
      level: level || (isDevelopment ? 'debug' : 'info'),
      base: this.infrastructureContext,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label: string) => {
          return { level: label };
        },
      },
      redact: {
        paths: redact,
        remove: true,
      },
      ...(isTest && { enabled: false }), // Disable logging in tests unless explicitly enabled
    };

    // Pretty print in development
    if (prettyPrint !== undefined ? prettyPrint : isDevelopment) {
      return pino(
        {
          ...defaultOptions,
          ...pinoOptions,
        },
        pino.transport({
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'yyyy-mm-dd HH:MM:ss.l',
            ignore: 'pid,hostname,env,app,context',
            singleLine: false,
            hideObject: false,
          },
        })
      );
    }

    return pino({
      ...defaultOptions,
      ...pinoOptions,
    });
  }

  /**
   * Get OpenTelemetry trace context if available
   * Uses cached OpenTelemetry API reference to avoid repeated require() calls
   */
  private getOpenTelemetryContext(
    existingContext: Record<string, unknown>
  ): Record<string, unknown> {
    const otelTraceContext: Record<string, unknown> = {};
    const trace = getOtelTrace();

    if (trace) {
      const activeSpan = trace.getActiveSpan?.();
      if (activeSpan) {
        const spanContext = activeSpan.spanContext();
        // Only use OpenTelemetry trace IDs if not already in context (OpenTelemetry is source of truth)
        if (!existingContext.traceId && spanContext.traceId) {
          otelTraceContext.traceId = spanContext.traceId;
        }
        if (!existingContext.spanId && spanContext.spanId) {
          otelTraceContext.spanId = spanContext.spanId;
        }
      }
    }

    return otelTraceContext;
  }

  /**
   * Check if service/method should be included in context
   */
  private shouldIncludeServiceMethod(context: Record<string, unknown>): boolean {
    return context.component !== 'http';
  }

  /**
   * Get automatic context from AsyncLocalStorage and stack trace
   * Filters out invalid context values and improves context extraction
   * Also includes OpenTelemetry trace context when available
   * Caches caller context in CLS to avoid expensive stack trace parsing on every log call
   */
  private getAutoContext(): Record<string, unknown> {
    const context: Record<string, unknown> =
      (this.loggerContextService?.getAll() as Record<string, unknown>) || {};

    // Cache caller context in CLS to avoid expensive stack trace parsing on every log call
    // Only extract if not already cached and if we need service/method context
    let caller: { service?: string; method?: string } | undefined;
    if (this.shouldIncludeServiceMethod(context) && !context.service && !context.method) {
      // Check if caller context is already cached in CLS
      const cachedCaller = this.loggerContextService?.getValue('_cachedCaller') as
        | { service?: string; method?: string }
        | undefined;

      if (cachedCaller) {
        caller = cachedCaller;
      } else {
        // Extract caller context and cache it
        caller = getCallerContext();
        if (caller.service || caller.method) {
          this.loggerContextService?.set('_cachedCaller', caller);
        }
      }
    }

    // Get OpenTelemetry trace context if available
    const otelTraceContext = this.getOpenTelemetryContext(context);
    const autoContext: Record<string, unknown> = { ...context, ...otelTraceContext };

    // Only add service if it's meaningful (not internal framework class)
    // AND if component is not 'http' (HTTP logs shouldn't have service/method)
    if (
      caller?.service &&
      !context.service &&
      this.shouldIncludeServiceMethod(context) &&
      !INTERNAL_CLASSES.has(caller.service)
    ) {
      autoContext.service = caller.service;
    }

    // Only add method if it's meaningful (not internal method)
    // AND if component is not 'http'
    if (
      caller?.method &&
      !context.method &&
      this.shouldIncludeServiceMethod(context) &&
      !INTERNAL_METHODS.has(caller.method)
    ) {
      autoContext.method = caller.method;
    }

    // Clean up any invalid context values
    return cleanLogData(autoContext);
  }

  /**
   * Log a message at the specified level
   * Enhanced to provide better context for NestJS lifecycle events
   */
  log(message: unknown, context?: string): void {
    const autoContext = this.getAutoContext();
    const rawMessage = typeof message === 'string' ? message : this.formatMessage(message);

    // Extract meaningful context from NestJS lifecycle messages
    let logContext = context || this.context || autoContext.service;

    // Parse NestJS lifecycle messages for better context
    if (typeof rawMessage === 'string') {
      // Handle "X dependencies initialized" messages
      const depsMatch = rawMessage.match(
        /(\w+Module|InstanceLoader|NestApplication|NestFactory)\s+(.+)/
      );
      if (depsMatch) {
        logContext = depsMatch[1];
      }
      // Handle "Starting Nest application" messages
      else if (rawMessage.includes('Starting Nest application')) {
        logContext = 'NestFactory';
      }
      // Handle "Nest application successfully started" messages
      else if (rawMessage.includes('successfully started')) {
        logContext = 'NestApplication';
      }
    }

    const { context: _, ...cleanAutoContext } = autoContext;
    const logData = {
      ...cleanAutoContext,
    };

    // Format message with context
    const messageStr = this.formatMessage(message, { ...logData, context: logContext });

    this.logger.info(logData, messageStr);
  }

  /**
   * Log an error message
   * Generic error logger - does not handle BaseError's loggable flag.
   * BaseError logging should be handled by BaseErrorExceptionFilter.
   *
   * @param message - Error message or Error instance
   * @param meta - Optional metadata object
   * @param context - Optional context string
   */
  error(message: unknown, meta?: Record<string, unknown>, context?: string): void {
    const autoContext = this.getAutoContext();
    const logContext = context || this.context || (autoContext.service as string);
    const baseErrorContext = cleanLogData(autoContext);

    // Build error context by merging metadata
    const errorContext: Record<string, unknown> = { ...baseErrorContext };

    // Merge metadata if provided
    if (meta && typeof meta === 'object') {
      Object.entries(meta).forEach(([key, value]) => {
        if (isValidContextValue(value, key)) {
          errorContext[key] = value;
        }
      });
    }

    if (message instanceof Error) {
      // Format stack trace as array
      const stackArray = message.stack ? formatStackTrace(message.stack) : undefined;

      const errorMeta: Record<string, unknown> = {
        ...errorContext,
        errorName: message.name,
        ...(stackArray && { stack: stackArray }),
        ...(typeof message.cause !== 'undefined' ? { cause: formatCause(message.cause) } : {}),
      };

      this.logger.error(
        errorMeta,
        this.formatMessage(message.message, { ...errorMeta, context: logContext })
      );
    } else {
      this.logger.error(
        errorContext,
        this.formatMessage(message, { ...errorContext, context: logContext })
      );
    }
  }

  /**
   * Log a warning message with optional metadata
   */
  warn(message: unknown, metaOrContext?: Record<string, unknown> | string, context?: string): void {
    const autoContext = this.getAutoContext();
    let logContext: string | undefined;
    let meta: Record<string, unknown> | undefined;

    // Handle overloaded parameters
    if (metaOrContext) {
      if (typeof metaOrContext === 'string') {
        // Legacy: second parameter is context string
        logContext = metaOrContext;
      } else if (typeof metaOrContext === 'object') {
        // New: second parameter is metadata object
        meta = metaOrContext;
        logContext = context;
      }
    } else {
      logContext = context;
    }

    logContext = logContext || this.context || (autoContext.service as string);
    const logData = cleanLogData(autoContext);

    // Merge metadata if provided, using consistent validation
    if (meta && typeof meta === 'object') {
      Object.entries(meta).forEach(([key, value]) => {
        if (isValidContextValue(value, key)) {
          logData[key] = value;
        }
      });
    }

    this.logger.warn(logData, this.formatMessage(message, { ...logData, context: logContext }));
  }

  /**
   * Log a debug message
   */
  debug(message: unknown, context?: string): void {
    const autoContext = this.getAutoContext();
    const logContext = context || this.context || (autoContext.service as string);
    const logData = cleanLogData(autoContext);

    this.logger.debug(logData, this.formatMessage(message, { ...logData, context: logContext }));
  }

  /**
   * Log a verbose message
   */
  verbose(message: unknown, context?: string): void {
    const autoContext = this.getAutoContext();
    const logContext = context || this.context || (autoContext.service as string);
    const logData = cleanLogData(autoContext);

    this.logger.trace(logData, this.formatMessage(message, { ...logData, context: logContext }));
  }

  /**
   * Log at info level with additional metadata
   * Enhanced to clean up and structure log data better
   */
  info(message: unknown, meta?: Record<string, unknown>, context?: string): void {
    const autoContext = this.getAutoContext();
    const logContext = context || this.context || (autoContext.service as string);
    let logData = cleanLogData(autoContext);

    // For HTTP component logs, exclude service and method (they're not relevant)
    // This must happen BEFORE merging meta to prevent meta from overriding
    if (!this.shouldIncludeServiceMethod(logData)) {
      delete logData.service;
      delete logData.method;
    }

    // Merge metadata, filtering out invalid values
    if (meta && typeof meta === 'object') {
      Object.entries(meta).forEach(([key, value]) => {
        // Skip invalid context values and context field
        if (
          isValidContextValue(value, key) &&
          // Don't allow meta to add service/method to HTTP logs
          (this.shouldIncludeServiceMethod(logData) || (key !== 'service' && key !== 'method'))
        ) {
          logData[key] = value;
        }
      });
    }

    // Final cleanup
    logData = cleanLogData(logData);

    this.logger.info(logData, this.formatMessage(message, { ...logData, context: logContext }));
  }

  /**
   * Log at fatal level
   */
  fatal(message: unknown, context?: string): void {
    const autoContext = this.getAutoContext();
    const logContext = context || this.context || (autoContext.service as string);
    const logData = cleanLogData(autoContext);

    if (message instanceof Error) {
      // Format stack trace as array
      const stackArray = message.stack ? formatStackTrace(message.stack) : undefined;

      this.logger.fatal(
        {
          ...logData,
          errorName: message.name,
          ...(stackArray && { stack: stackArray }),
          ...(typeof message.cause !== 'undefined' ? { cause: formatCause(message.cause) } : {}),
        },
        this.formatMessage(message.message, { ...logData, context: logContext })
      );
    } else {
      this.logger.fatal(logData, this.formatMessage(message, { ...logData, context: logContext }));
    }
  }

  /**
   * Get the underlying Pino logger instance
   */
  getPinoLogger(): PinoLogger {
    return this.logger;
  }

  /**
   * Format message with optional context information
   * Formats as: [context] message
   */
  private formatMessage(message: unknown, context?: Record<string, unknown>): string {
    let formatted: string;

    if (typeof message === 'string') {
      formatted = message;
    } else if (message instanceof Error && 'message' in message) {
      formatted = message.message;
    } else {
      formatted = JSON.stringify(message);
    }

    // Add context info to message at the start if available and not already included
    if (context) {
      const logContext = context.context as string;

      // Only add context if it exists and message doesn't already start with it
      if (logContext && typeof logContext === 'string') {
        const contextPrefix = `[${logContext}]`;
        if (!formatted.startsWith(contextPrefix)) {
          formatted = `${contextPrefix} ${formatted}`;
        }
      }
    }

    return formatted;
  }
}
