import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
  Optional,
} from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { uuid } from '@sklv-labs/ts-core';
import { ClsService } from '@sklv-labs/ts-nestjs-cls';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';

import { DEFAULT_MAX_BODY_LENGTH, DEFAULT_SKIP_PATHS } from '../constants/log-constants';
import { extractTraceContext, getStatusCategory, getTimeBucket, LoggerService } from '../logger';
import { sanitizeObject, truncateData } from '../utils/log-utils';

export interface HttpLoggingInterceptorOptions {
  /**
   * Log request body
   * @default true
   */
  logRequestBody?: boolean;
  /**
   * Log response body
   * @default false (can be verbose)
   */
  logResponseBody?: boolean;
  /**
   * Log query parameters
   * @default true
   */
  logQuery?: boolean;
  /**
   * Log request headers
   * @default false (can contain sensitive data)
   */
  logHeaders?: boolean;
  /**
   * Maximum length of body to log (to avoid huge payloads)
   * @default 1000
   */
  maxBodyLength?: number;
  /**
   * Skip logging for these paths (e.g., health checks)
   */
  skipPaths?: string[];
  /**
   * Skip logging for these HTTP methods
   */
  skipMethods?: string[];
}

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger: LoggerService;
  private readonly cls: ClsService;

  constructor(
    @Inject(LoggerService) loggerService: LoggerService,
    @Inject(ClsService) clsService: ClsService,
    @Optional() private readonly options: HttpLoggingInterceptorOptions = {}
  ) {
    this.logger = loggerService;
    this.cls = clsService;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();

    const {
      logRequestBody = true,
      logResponseBody = false,
      logQuery = true,
      logHeaders = false,
      maxBodyLength = DEFAULT_MAX_BODY_LENGTH,
      skipPaths = [...DEFAULT_SKIP_PATHS],
      skipMethods = [],
    } = this.options;

    // Skip logging for specific paths or methods
    if (
      skipPaths.some((path) => request.path.includes(path)) ||
      skipMethods.includes(request.method)
    ) {
      return next.handle();
    }

    const startTime = Date.now();

    // Handle header type (can be string or string[])
    const requestIdHeader = request.headers['x-request-id'] || request.headers['x-correlation-id'];
    const requestIdStr = Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader;
    const requestId = requestIdStr || uuid();

    // Extract trace context from headers
    const traceContext = extractTraceContext(request.headers);

    // Get active span from OpenTelemetry (auto-instrumentation creates this)
    // This ensures we use the actual trace/span IDs from OpenTelemetry
    const activeSpan = trace.getActiveSpan();
    let otelTraceId: string | undefined;
    let otelSpanId: string | undefined;
    let otelParentSpanId: string | undefined;

    if (activeSpan) {
      const spanContext = activeSpan.spanContext();
      otelTraceId = spanContext.traceId;
      otelSpanId = spanContext.spanId;
      // Get parent span ID from trace context if available
      otelParentSpanId = traceContext.parentSpanId;
    }

    // Prefer OpenTelemetry trace IDs over extracted headers (more accurate)
    const finalTraceId = otelTraceId || traceContext.traceId;
    const finalSpanId = otelSpanId || traceContext.spanId || uuid();
    const finalParentSpanId = otelParentSpanId || traceContext.parentSpanId;

    // Add request ID and trace context to response headers
    response.setHeader('x-request-id', requestId);
    if (finalTraceId) {
      response.setHeader('x-trace-id', finalTraceId);
      // Also set traceparent header for W3C Trace Context
      response.setHeader('traceparent', `00-${finalTraceId}-${finalSpanId}-01`);
    }
    response.setHeader('x-span-id', finalSpanId);

    // Set context in CLS for automatic inclusion in all logs
    const user = (request as Request & { user?: { id?: string; userId?: string; role?: string } })
      .user;
    const userId = user?.id || user?.userId;
    const userRole = user?.role;

    const loggerCtx = {
      requestId,
      userId,
      userRole,
      component: 'http',
      traceId: finalTraceId,
      spanId: finalSpanId,
      parentSpanId: finalParentSpanId,
      ...(traceContext.traceFlags && { traceFlags: traceContext.traceFlags }),
    };

    // Set context in CLS
    // Note: CLS middleware already creates a context for HTTP requests,
    // so we just set values directly without using loggerContext.run()
    Object.entries(loggerCtx).forEach(([key, value]) => {
      if (value !== undefined) {
        this.cls.set(key, value);
      }
    });

    // Capture response body from both observable stream and response methods
    // Always wrap methods to capture error response bodies (set by exception filters)
    // but only log them if logResponseBody is enabled
    let responseBody: unknown = undefined;

    // Always intercept response methods to capture body (needed for error responses)
    // This ensures we capture response bodies set by exception filters
    const originalJson = response.json.bind(response);
    const originalSend = response.send.bind(response);

    response.json = function (body?: unknown) {
      responseBody = body;
      return originalJson(body);
    };

    response.send = function (body?: unknown) {
      if (typeof body === 'string') {
        try {
          responseBody = JSON.parse(body);
        } catch {
          responseBody = body;
        }
      } else {
        responseBody = body;
      }
      return originalSend(body);
    };

    // Execute the request handler - CLS context is already active from middleware
    return (() => {
      // Request log
      const requestRoute = request.route as { path?: string } | undefined;
      const requestQuery = request.query as Record<string, unknown> | undefined;
      const requestParams = request.params as Record<string, unknown> | undefined;
      const requestCookies = request.cookies as Record<string, unknown> | undefined;
      const requestBody = request.body as Record<string, unknown> | undefined;

      const requestLog: Record<string, unknown> = {
        method: request.method,
        url: request.url,
        path: request.path,
        ...(requestRoute?.path && { route: requestRoute.path }),
        ip: request.ip || request.socket.remoteAddress,
        userAgent: request.headers['user-agent'],
        httpVersion: request.httpVersion,
        protocol: request.protocol,
        host: request.get('host'),
        referer: request.get('referer'),
        origin: request.get('origin'),
        contentType: request.get('content-type'),
        contentLength: (() => {
          const contentLength = request.get('content-length');
          return contentLength ? parseInt(contentLength, 10) : undefined;
        })(),
        startTime,
        ...(logHeaders && {
          headers: sanitizeObject(request.headers as Record<string, unknown>),
        }),
        ...(logQuery &&
          requestQuery &&
          Object.keys(requestQuery).length > 0 && {
            query: sanitizeObject(requestQuery),
          }),
        ...(requestParams &&
          Object.keys(requestParams).length > 0 && {
            params: requestParams,
          }),
        ...(requestCookies &&
          Object.keys(requestCookies).length > 0 && {
            cookies: sanitizeObject(requestCookies),
          }),
        ...(logRequestBody &&
          requestBody &&
          Object.keys(requestBody).length > 0 && {
            body: truncateData(requestBody, maxBodyLength),
          }),
      };

      const requestMessage = `REQUEST ${request.method} ${request.path || request.url}`;
      this.logger.info(requestMessage, requestLog, 'HTTP');

      // Log response when it finishes (after exception filter sets status/body)
      const logResponse = () => {
        const duration = Date.now() - startTime;
        const actualStatusCode = response.statusCode;
        const statusCategory = getStatusCategory(actualStatusCode);
        const responseTimeBucket = getTimeBucket(duration);
        const responseHeaders: Record<string, unknown> = response.getHeaders() as Record<
          string,
          unknown
        >;
        const responseCookiesTyped: Record<string, unknown> | undefined = requestCookies
          ? requestCookies
          : undefined;

        const responseLog: Record<string, unknown> = {
          method: request.method,
          url: request.url,
          path: request.path,
          statusCode: actualStatusCode,
          statusCategory,
          success: actualStatusCode < 400,
          responseTime: `${duration}ms`,
          responseTimeMs: duration,
          responseTimeBucket,
          startTime,
          endTime: Date.now(),
          ip: request.ip || request.socket.remoteAddress,
          userAgent: request.headers['user-agent'],
          responseSize: (() => {
            const contentLength = response.get('content-length');
            return contentLength ? parseInt(contentLength, 10) : undefined;
          })(),
          contentType: response.get('content-type'),
          ...(logHeaders && {
            requestHeaders: sanitizeObject(request.headers as Record<string, unknown>),
            responseHeaders,
          }),
          ...(responseCookiesTyped &&
            Object.keys(responseCookiesTyped).length > 0 && {
              requestCookies: sanitizeObject(responseCookiesTyped),
            }),
        };

        // Always log response body for error responses (4xx, 5xx) for debugging
        // Log successful response bodies only if logResponseBody is enabled
        const shouldLogBody =
          logResponseBody || (actualStatusCode >= 400 && responseBody !== undefined);
        if (shouldLogBody && responseBody !== undefined) {
          responseLog.responseBody = truncateData(responseBody, maxBodyLength);
        }

        const logMessage = `RESPONSE ${request.method} ${request.path || request.url} ${actualStatusCode} - ${duration}ms`;
        this.logger.info(logMessage, responseLog, 'HTTP');
      };

      // Hook into response finish event to log after everything is done
      response.once('finish', logResponse);

      return next.handle().pipe(
        tap((_data: unknown) => {
          // For successful responses, capture the data
          if (logResponseBody && _data !== undefined && responseBody === undefined) {
            responseBody = _data;
          }
        }),
        catchError((error: unknown) => {
          // Don't log here - let the 'finish' event handle it
          // The exception filter will set the status code and body, then 'finish' will fire
          throw error;
        })
      );
    })();
  }
}
