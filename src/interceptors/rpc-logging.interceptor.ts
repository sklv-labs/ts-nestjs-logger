import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
  Optional,
} from '@nestjs/common';
import { uuid } from '@sklv-labs/ts-core';
import { ClsService } from '@sklv-labs/ts-nestjs-cls';
import { Observable, defer } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';

import { DEFAULT_MAX_BODY_LENGTH } from '../constants/log-constants';
import { LoggerService } from '../logger/logger.service';
import { truncateData } from '../utils/log-utils';

export interface RpcLoggingInterceptorOptions {
  /**
   * Log request data
   * @default true
   */
  logRequestData?: boolean;
  /**
   * Log response data
   * @default false
   */
  logResponseData?: boolean;
  /**
   * Maximum length of data to log
   * @default 1000
   */
  maxDataLength?: number;
  /**
   * Skip logging for these patterns
   */
  skipPatterns?: string[];
}

@Injectable()
export class RpcLoggingInterceptor implements NestInterceptor {
  private readonly logger: LoggerService;
  private readonly cls: ClsService;

  constructor(
    @Inject(LoggerService) loggerService: LoggerService,
    @Inject(ClsService) clsService: ClsService,
    @Optional() private readonly options: RpcLoggingInterceptorOptions = {}
  ) {
    this.logger = loggerService;
    this.cls = clsService;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const {
      logRequestData = true,
      logResponseData = false,
      maxDataLength = DEFAULT_MAX_BODY_LENGTH,
      skipPatterns = [],
    } = this.options;

    // Get RPC context (works with NestJS microservices)
    const rpcContext = context.switchToRpc();
    const data: unknown = rpcContext.getData();
    const rpcContextRaw: unknown = rpcContext.getContext();
    const rpcContextData =
      rpcContextRaw && typeof rpcContextRaw === 'object'
        ? (rpcContextRaw as { pattern?: string; transport?: string })
        : undefined;
    const pattern: string = rpcContextData?.pattern || context.getClass()?.name || 'unknown';

    // Skip logging for specific patterns
    if (skipPatterns.some((skipPattern: string) => pattern.includes(skipPattern))) {
      return next.handle();
    }

    const startTime = Date.now();
    const requestId = uuid();

    const loggerContext = {
      requestId,
      component: 'rpc',
    };

    // For RPC, we need to create a CLS context since there's no HTTP middleware
    // Use defer() to ensure CLS context is preserved throughout the entire observable chain
    return this.cls.run(() => {
      // Set context values in the CLS context
      Object.entries(loggerContext).forEach(([key, value]) => {
        if (value !== undefined) {
          this.cls.set(key, value);
        }
      });

      // Execute the RPC handler within the CLS context
      const transportValue = rpcContextData?.transport || 'unknown';
      const requestLog: Record<string, unknown> = {
        pattern: String(pattern),
        transport: String(transportValue),
      };
      if (logRequestData && data) {
        requestLog.data = truncateData(data, maxDataLength);
      }

      this.logger.info('Incoming RPC request', requestLog);

      // Use defer() to ensure the entire observable chain runs within CLS context
      return defer(() => next.handle()).pipe(
        tap((responseData: unknown) => {
          // CLS context is preserved here
          const duration = Date.now() - startTime;
          const responseLog: Record<string, unknown> = {
            pattern,
            duration: `${duration}ms`,
          };
          if (logResponseData && responseData) {
            responseLog.responseData = truncateData(responseData, maxDataLength);
          }

          this.logger.info('RPC response', responseLog);
        }),
        catchError((error: unknown) => {
          // CLS context is preserved here
          // Don't log the error here - let BaseErrorExceptionFilter handle it
          // Only log request metadata for timing/debugging
          const duration = Date.now() - startTime;
          const responseLog: Record<string, unknown> = {
            pattern,
            duration: `${duration}ms`,
            status: 'error',
          };

          this.logger.info('RPC request completed with error', responseLog);

          throw error;
        })
      );
    });
  }
}
