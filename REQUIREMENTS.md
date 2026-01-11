# Logger Package Requirements

## Overview
The `@sklv-labs/ts-nestjs-logger` package provides structured logging for NestJS applications with:
- Integration with `@sklv-labs/ts-nestjs-cls` for request-scoped context
- Integration with `@sklv-labs/ts-nestjs-error` for error logging
- Support for HTTP, RPC, and WebSocket transports
- Structured logging using Pino
- Automatic context extraction from CLS

## Core Requirements

### 1. Dependencies
- **@sklv-labs/ts-core**: For `Environments` enum, `uuid()`, and `getAppVersion()`
- **@sklv-labs/ts-nestjs-cls**: For request-scoped context storage (REQUIRED)
- **@sklv-labs/ts-nestjs-error**: For BaseError integration (optional but recommended)
- **nestjs-cls**: Peer dependency (via ts-nestjs-cls)
- **pino**: Structured logging library
- **pino-pretty**: Pretty printing for development

### 2. LoggerService Features
- Implements NestJS `LoggerService` interface
- Uses Pino for structured logging
- Automatically extracts context from CLS (requestId, traceId, userId, etc.)
- Supports all log levels: trace, debug, info, warn, error, fatal
- Handles BaseError with `loggable` flag (respects `loggable: false`)
- Pretty printing in development, JSON in production
- Automatic redaction of sensitive fields
- Infrastructure context (hostname, pod, region, version, etc.)

### 3. LoggerModule
- Global module
- Requires ClsModule to be imported first
- Supports `forRoot()` and `forRootAsync()`
- Provides LoggerService and LoggerContextService

### 4. LoggerContextService
- Wrapper around ClsService for type-safe context access
- Provides methods: `get()`, `set()`, `getValue()`, `getAll()`, `run()`

### 5. Interceptors
- **HttpLoggingInterceptor**: Logs HTTP requests/responses
  - Extracts requestId from headers or generates UUID
  - Extracts trace context (OpenTelemetry compatible)
  - Logs request/response with timing
  - Sets CLS context for automatic inclusion in logs
- **RpcLoggingInterceptor**: Logs RPC requests/responses
  - Creates CLS context for RPC calls
  - Logs pattern, data, and timing
- **WebSocketLoggingInterceptor**: Logs WebSocket messages
  - Creates CLS context for WS messages
  - Logs event, data, and timing

### 6. Exception Filter (NEW)
- **BaseErrorExceptionFilter**: Catches BaseError instances
  - Respects `loggable` flag (only logs if `loggable: true`)
  - Logs error with full context (code, metadata, stack, etc.)
  - Sets transport context on error
  - Uses error's `toJSON()` method for structured logging

### 7. Context Fields
The logger automatically includes these fields from CLS:
- `requestId`, `correlationId`, `transactionId`
- `traceId`, `spanId`, `parentSpanId`
- `userId`, `userRole`, `sessionId`
- `component` (http/rpc/ws)
- `service`, `method` (from stack trace)
- `tenantId`, `organizationId`
- Custom fields via LoggerContextService

### 8. Error Handling
- BaseError instances are logged with full context
- Respects `loggable` flag to prevent logging validation errors
- Includes error code, metadata, stack trace
- Preserves error cause chain

## Integration Requirements

### Required Setup
```typescript
// app.module.ts
import { ClsModule } from '@sklv-labs/ts-nestjs-cls';
import { LoggerModule } from '@sklv-labs/ts-nestjs-logger';

@Module({
  imports: [
    ClsModule.forRoot(), // MUST be imported first
    LoggerModule.forRoot({
      appName: 'my-app',
      environment: Environments.PRODUCTION,
    }),
  ],
})
export class AppModule {}
```

### Exception Filter Setup
```typescript
// main.ts
import { BaseErrorExceptionFilter } from '@sklv-labs/ts-nestjs-logger';

app.useGlobalFilters(new BaseErrorExceptionFilter());
```

## Usage Examples

### Basic Logging
```typescript
constructor(private readonly logger: LoggerService) {}

this.logger.info('User created', { userId: '123' });
this.logger.error('Operation failed', { errorCode: 'OP_FAILED' });
```

### With BaseError
```typescript
throw new BaseError('User not found', 'USER_NOT_FOUND', {
  statusCode: 404,
  metadata: { userId: '123' },
  loggable: true, // Will be logged
});
```

### Context Management
```typescript
constructor(
  private readonly logger: LoggerService,
  private readonly loggerContext: LoggerContextService
) {}

// Set context
this.loggerContext.set('userId', '123');
this.loggerContext.set('tenantId', 'tenant-1');

// All subsequent logs will include this context
this.logger.info('Operation started'); // Includes userId and tenantId
```
