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

export interface WebSocketLoggingInterceptorOptions {
  /**
   * Log message data
   * @default true
   */
  logMessageData?: boolean;
  /**
   * Log client info
   * @default true
   */
  logClientInfo?: boolean;
  /**
   * Maximum length of data to log
   * @default 1000
   */
  maxDataLength?: number;
  /**
   * Skip logging for these events
   */
  skipEvents?: string[];
}

@Injectable()
export class WebSocketLoggingInterceptor implements NestInterceptor {
  private readonly logger: LoggerService;
  private readonly cls: ClsService;

  constructor(
    @Inject(LoggerService) loggerService: LoggerService,
    @Inject(ClsService) clsService: ClsService,
    @Optional() private readonly options: WebSocketLoggingInterceptorOptions = {}
  ) {
    this.logger = loggerService;
    this.cls = clsService;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const {
      logMessageData = true,
      logClientInfo = true,
      maxDataLength = DEFAULT_MAX_BODY_LENGTH,
      skipEvents = ['ping', 'pong'],
    } = this.options;

    // Get WebSocket context
    const wsContext = context.switchToWs();
    const client: unknown = wsContext.getClient();
    const data: unknown = wsContext.getData();
    const pattern: string = wsContext.getPattern() || 'unknown';

    // Skip logging for specific events
    if (skipEvents.includes(pattern)) {
      return next.handle();
    }

    const startTime = Date.now();
    const requestId = uuid();

    const loggerContext = {
      requestId,
      component: 'websocket',
    };

    // For WebSocket, we need to create a CLS context since there's no HTTP middleware
    // Use defer() to ensure CLS context is preserved throughout the entire observable chain
    return this.cls.run(() => {
      // Set context values in the CLS context
      Object.entries(loggerContext).forEach(([key, value]) => {
        if (value !== undefined) {
          this.cls.set(key, value);
        }
      });

      // Execute the WebSocket handler within the CLS context
      const clientTyped:
        | { id?: string; handshake?: { address?: string; headers?: Record<string, unknown> } }
        | undefined =
        client && typeof client === 'object'
          ? (client as {
              id?: string;
              handshake?: { address?: string; headers?: Record<string, unknown> };
            })
          : undefined;
      const requestLog: Record<string, unknown> = {
        event: String(pattern),
      };
      if (logClientInfo && clientTyped) {
        if (clientTyped.id) requestLog.clientId = clientTyped.id;
        if (clientTyped.handshake?.address) requestLog.clientIp = clientTyped.handshake.address;
        if (clientTyped.handshake?.headers)
          requestLog.clientHeaders = clientTyped.handshake.headers;
      }
      if (logMessageData && data) {
        requestLog.data = truncateData(data, maxDataLength);
      }

      this.logger.info('WebSocket message received', requestLog);

      // Use defer() to ensure the entire observable chain runs within CLS context
      return defer(() => next.handle()).pipe(
        tap((responseData: unknown) => {
          // CLS context is preserved here
          const duration = Date.now() - startTime;
          const responseLog: Record<string, unknown> = {
            event: pattern,
            duration: `${duration}ms`,
          };
          if (responseData) {
            responseLog.responseData = truncateData(responseData, maxDataLength);
          }

          this.logger.info('WebSocket response', responseLog);
        }),
        catchError((error: unknown) => {
          // CLS context is preserved here
          // Don't log the error here - let BaseErrorExceptionFilter handle it
          // Only log request metadata for timing/debugging
          const duration = Date.now() - startTime;
          const responseLog: Record<string, unknown> = {
            event: pattern,
            duration: `${duration}ms`,
            status: 'error',
          };

          this.logger.info('WebSocket request completed with error', responseLog);

          throw error;
        })
      );
    });
  }
}
