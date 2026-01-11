# @sklv-labs/ts-nestjs-logger

A comprehensive structured logging package for NestJS applications with Pino, CLS integration, and BaseError support.

## Features

- 🎯 **Type-Safe** - Full TypeScript support with comprehensive type definitions
- 🚀 **Structured Logging** - JSON logs in production, pretty logs in development
- 🛠️ **CLS Integration** - Automatic request-scoped context via `@sklv-labs/ts-nestjs-cls`
- 📦 **BaseError Support** - Respects `loggable` flag and provides structured error logging
- 🔌 **Multi-Transport** - HTTP, RPC, and WebSocket logging interceptors
- 📊 **Rich Context** - Automatic extraction of requestId, traceId, userId, and more
- 🔒 **Security** - Automatic redaction of sensitive fields
- 🌐 **OpenTelemetry** - Automatic trace context extraction

## Installation

```bash
npm install @sklv-labs/ts-nestjs-logger
```

### Peer Dependencies

This package requires the following peer dependencies:

```bash
npm install @nestjs/common@^11.1.11 @nestjs/core@^11.1.11 @sklv-labs/ts-nestjs-cls@^0.1.0 nestjs-cls@^6.1.0
```

**Note:** This package requires Node.js 24 LTS or higher.

## Quick Start

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { ClsModule } from '@sklv-labs/ts-nestjs-cls';
import { LoggerModule } from '@sklv-labs/ts-nestjs-logger';
import { Environments } from '@sklv-labs/ts-core';

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

### Setup Exception Filter

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { BaseErrorExceptionFilter } from '@sklv-labs/ts-nestjs-logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Add BaseError exception filter
  app.useGlobalFilters(new BaseErrorExceptionFilter(
    app.get(LoggerService),
    app.get(ClsService)
  ));
  
  await app.listen(3000);
}
bootstrap();
```

## Usage

### Basic Logging

```typescript
import { Injectable } from '@nestjs/common';
import { LoggerService } from '@sklv-labs/ts-nestjs-logger';

@Injectable()
export class MyService {
  constructor(private readonly logger: LoggerService) {}

  doSomething() {
    this.logger.info('Operation started', { operationId: '123' });
    this.logger.debug('Debug information', { data: 'value' });
    this.logger.warn('Warning message', { warningCode: 'WARN_001' });
    this.logger.error('Error occurred', { errorCode: 'ERR_001' });
  }
}
```

### With BaseError

```typescript
import { BaseError } from '@sklv-labs/ts-nestjs-error';
import { LoggerService } from '@sklv-labs/ts-nestjs-logger';

@Injectable()
export class MyService {
  constructor(private readonly logger: LoggerService) {}

  async findUser(userId: string) {
    try {
      // ... operation
    } catch (error) {
      // This will be automatically logged by BaseErrorExceptionFilter
      throw new BaseError('User not found', 'USER_NOT_FOUND', {
        statusCode: 404,
        metadata: { userId },
        loggable: true, // Will be logged
      });
    }
  }

  validateInput(data: unknown) {
    if (!data) {
      // This won't be logged (loggable: false)
      throw new BaseError('Invalid input', 'VALIDATION_ERROR', {
        statusCode: 400,
        loggable: false, // Won't be logged
      });
    }
  }
}
```

### Context Management

```typescript
import { Injectable } from '@nestjs/common';
import { LoggerContextService, LoggerService } from '@sklv-labs/ts-nestjs-logger';

@Injectable()
export class MyService {
  constructor(
    private readonly logger: LoggerService,
    private readonly loggerContext: LoggerContextService
  ) {}

  async processRequest() {
    // Set context that will be included in all subsequent logs
    this.loggerContext.set('userId', 'user-123');
    this.loggerContext.set('tenantId', 'tenant-1');
    this.loggerContext.set('operationId', 'op-456');

    // All logs will automatically include userId, tenantId, and operationId
    this.logger.info('Processing request');
    this.logger.debug('Step 1 completed');
    this.logger.info('Step 2 completed');
  }
}
```

### HTTP Logging Interceptor

```typescript
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HttpLoggingInterceptor } from '@sklv-labs/ts-nestjs-logger';

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpLoggingInterceptor,
    },
  ],
})
export class AppModule {}
```

### Async Configuration

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClsModule } from '@sklv-labs/ts-nestjs-cls';
import { LoggerModule } from '@sklv-labs/ts-nestjs-logger';
import { Environments } from '@sklv-labs/ts-core';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ClsModule.forRoot(),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        appName: config.get('APP_NAME', 'my-app'),
        environment: (config.get('NODE_ENV') as Environments) || Environments.DEVELOPMENT,
        level: config.get('LOG_LEVEL', 'info'),
        prettyPrint: config.get('LOG_PRETTY', 'false') === 'true',
      }),
    }),
  ],
})
export class AppModule {}
```

## API Reference

### LoggerService

Implements NestJS `LoggerService` interface with additional methods.

#### Methods

- `log(message: unknown, context?: string): void` - Log at info level
- `error(message: unknown, metaOrTrace?: string | Record<string, unknown>, context?: string): void` - Log error
- `warn(message: unknown, metaOrContext?: Record<string, unknown> | string, context?: string): void` - Log warning
- `debug(message: unknown, context?: string): void` - Log debug message
- `verbose(message: unknown, context?: string): void` - Log verbose message
- `info(message: unknown, meta?: Record<string, unknown>, context?: string): void` - Log info with metadata
- `fatal(message: unknown, context?: string): void` - Log fatal error
- `getPinoLogger(): PinoLogger` - Get underlying Pino logger instance

### LoggerContextService

Service for managing request-scoped logging context.

#### Methods

- `get(): LoggerContext | undefined` - Get current context
- `getAll(): LoggerContext` - Get all context (returns empty object if none)
- `set(key: keyof LoggerContext, value: unknown): void` - Set context value
- `getValue<K extends keyof LoggerContext>(key: K): LoggerContext[K] | undefined` - Get specific context value
- `run<T>(context: LoggerContext, callback: () => T): T` - Run function with context

### Interceptors

#### HttpLoggingInterceptor

Logs HTTP requests and responses with timing, status codes, and context.

**Options:**
- `logRequestBody?: boolean` - Log request body (default: `true`)
- `logResponseBody?: boolean` - Log response body (default: `false`)
- `logQuery?: boolean` - Log query parameters (default: `true`)
- `logHeaders?: boolean` - Log headers (default: `false`)
- `maxBodyLength?: number` - Max body length to log (default: `1000`)
- `skipPaths?: string[]` - Paths to skip logging (default: `['/health', '/metrics']`)
- `skipMethods?: string[]` - HTTP methods to skip

#### RpcLoggingInterceptor

Logs RPC requests and responses for microservices.

**Options:**
- `logRequestData?: boolean` - Log request data (default: `true`)
- `logResponseData?: boolean` - Log response data (default: `false`)
- `maxDataLength?: number` - Max data length to log (default: `1000`)
- `skipPatterns?: string[]` - Patterns to skip logging

#### WebSocketLoggingInterceptor

Logs WebSocket messages and events.

**Options:**
- `logMessageData?: boolean` - Log message data (default: `true`)
- `logClientInfo?: boolean` - Log client info (default: `true`)
- `maxDataLength?: number` - Max data length to log (default: `1000`)
- `skipEvents?: string[]` - Events to skip logging (default: `['ping', 'pong']`)

### Filters

#### BaseErrorExceptionFilter

Exception filter for `BaseError` that:
- Respects `loggable` flag (only logs if `loggable: true`)
- Sets transport context automatically
- Provides structured error logging
- Handles HTTP, RPC, and WebSocket transports

## Configuration Options

```typescript
interface LoggerModuleOptions {
  environment?: Environments; // 'development' | 'production' | 'test'
  appName?: string; // Application name
  level?: string; // Log level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  prettyPrint?: boolean; // Enable pretty printing (default: true in dev)
  pinoOptions?: Partial<LoggerOptions>; // Additional Pino options
  redact?: string[]; // Fields to redact (default: password, token, etc.)
  serviceVersion?: string; // Service version (defaults to package.json)
}
```

## Context Fields

The logger automatically includes these fields from CLS context:

- **Request Correlation**: `requestId`, `correlationId`, `transactionId`, `operationId`
- **Distributed Tracing**: `traceId`, `spanId`, `parentSpanId`, `traceFlags`
- **User Context**: `userId`, `userRole`, `sessionId`
- **Service Context**: `component` (http/rpc/ws), `service`, `method`
- **Business Context**: `tenantId`, `organizationId`, `action`, `resource`, `resourceId`
- **Infrastructure**: `hostname`, `pod`, `container`, `region`, `zone`, `version`, `commit`

## Development

```bash
# Build
npm run build

# Lint
npm run lint

# Format
npm run format

# Test
npm run test

# Type check
npm run type-check
```

## License

MIT © [sklv-labs](https://github.com/sklv-labs)
