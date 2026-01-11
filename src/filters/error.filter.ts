import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { WsException } from '@nestjs/websockets';
import { ClsService } from '@sklv-labs/ts-nestjs-cls';
import { BaseError } from '@sklv-labs/ts-nestjs-error';
import { Request, Response } from 'express';

import { LoggerService } from '../logger/logger.service';
import { formatCause, formatStackTrace, isBaseError } from '../utils/log-utils';

/**
 * Exception filter for all errors that provides structured error logging with full context.
 * For BaseError instances, respects the loggable flag.
 */
@Injectable()
@Catch()
export class BaseErrorExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: LoggerService,
    private readonly cls: ClsService
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const contextType = host.getType();

    // Check if it's a BaseError
    if (isBaseError(exception)) {
      const baseError = exception;
      // Set transport context on the error
      if (contextType === 'http') {
        baseError.setTransportIfUnset('http');
      } else if (contextType === 'rpc') {
        baseError.setTransportIfUnset('rpc');
      } else if (contextType === 'ws') {
        baseError.setTransportIfUnset('ws');
      }

      // Only log if the error is loggable
      if (baseError.loggable) {
        const errorContext = this.buildErrorContext(baseError, host);
        this.logger.error(baseError, errorContext);
      }

      // Handle response based on transport type
      if (contextType === 'http') {
        this.handleHttpException(baseError, host);
      } else if (contextType === 'rpc') {
        this.handleRpcException(baseError, host);
      } else if (contextType === 'ws') {
        this.handleWsException(baseError, host);
      }
    } else {
      // Handle regular errors (non-BaseError)
      const error = exception instanceof Error ? exception : new Error(String(exception));
      const errorContext = this.buildErrorContextForRegularError(error, host);
      this.logger.error(error, errorContext);

      // Handle response based on transport type
      if (contextType === 'http') {
        this.handleHttpExceptionForRegularError(error, host);
      } else if (contextType === 'rpc') {
        this.handleRpcExceptionForRegularError(error, host);
      } else if (contextType === 'ws') {
        this.handleWsExceptionForRegularError(error, host);
      }
    }
  }

  /**
   * Extract relevant context from CLS (shared by both BaseError and regular error handlers)
   */
  private extractClsContext(): Record<string, unknown> {
    const clsContext: Record<string, unknown> = {};
    const store = this.cls.get();

    if (store) {
      const relevantKeys = [
        'requestId',
        'correlationId',
        'traceId',
        'spanId',
        'userId',
        'component',
        'service',
        'method',
      ];
      relevantKeys.forEach((key) => {
        const value: unknown = this.cls.get(key);
        if (value !== undefined) {
          clsContext[key] = value;
        }
      });
    }

    return clsContext;
  }

  private buildErrorContext(exception: BaseError, _host: ArgumentsHost): Record<string, unknown> {
    const context: Record<string, unknown> = {
      errorCode: exception.code,
      errorName: exception.name,
      transport: exception.transport,
      ...(exception.statusCode && { statusCode: exception.statusCode }),
      ...(exception.metadata && { metadata: exception.metadata }),
      ...(exception.cause ? { cause: formatCause(exception.cause) } : {}),
    };

    // Add stack trace if available
    if (exception.stack) {
      context.stack = formatStackTrace(exception.stack);
    }

    // Add context from CLS
    Object.assign(context, this.extractClsContext());

    return context;
  }

  private buildErrorContextForRegularError(
    error: Error,
    _host: ArgumentsHost
  ): Record<string, unknown> {
    const context: Record<string, unknown> = {
      errorName: error.name,
      errorMessage: error.message,
    };

    // Add stack trace if available
    if (error.stack) {
      context.stack = formatStackTrace(error.stack);
    }

    // Add cause if available
    if (error.cause) {
      context.cause = formatCause(error.cause);
    }

    // Add context from CLS
    Object.assign(context, this.extractClsContext());

    return context;
  }

  private handleHttpException(exception: BaseError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception.statusCode || HttpStatus.INTERNAL_SERVER_ERROR;
    const errorResponse = exception.getClientSafeError();

    // Add request ID to response if available
    const requestId: unknown = this.cls.get('requestId');
    if (requestId && typeof requestId === 'string') {
      response.setHeader('x-request-id', requestId);
    }

    response.status(status).json({
      ...errorResponse,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private handleRpcException(exception: BaseError, _host: ArgumentsHost): void {
    const errorResponse = exception.getRpcError();
    throw new RpcException(errorResponse);
  }

  private handleWsException(exception: BaseError, _host: ArgumentsHost): void {
    const errorResponse = exception.getRpcError();
    throw new WsException(errorResponse);
  }

  private handleHttpExceptionForRegularError(error: Error, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Default to 500 for unknown errors
    const status = HttpStatus.INTERNAL_SERVER_ERROR;

    // Add request ID to response if available
    const requestId: unknown = this.cls.get('requestId');
    if (requestId && typeof requestId === 'string') {
      response.setHeader('x-request-id', requestId);
    }

    response.status(status).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: error.message || 'An error occurred',
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private handleRpcExceptionForRegularError(error: Error, _host: ArgumentsHost): void {
    throw new RpcException({
      code: 'INTERNAL_SERVER_ERROR',
      message: error.message || 'An error occurred',
    });
  }

  private handleWsExceptionForRegularError(error: Error, _host: ArgumentsHost): void {
    throw new WsException({
      code: 'INTERNAL_SERVER_ERROR',
      message: error.message || 'An error occurred',
    });
  }
}
