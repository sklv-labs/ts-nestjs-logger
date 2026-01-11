# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-XX

### Added

- Initial release of @sklv-labs/ts-nestjs-logger
- `LoggerModule` with `forRoot` and `forRootAsync` methods for module configuration
- `LoggerService` implementing NestJS `LoggerService` interface with Pino
- `LoggerContextService` for managing request-scoped logging context
- `HttpLoggingInterceptor` for HTTP request/response logging
- `RpcLoggingInterceptor` for RPC request/response logging
- `WebSocketLoggingInterceptor` for WebSocket message logging
- `BaseErrorExceptionFilter` for structured error logging with BaseError support
- Comprehensive TypeScript type definitions
- Full documentation and usage examples

### Features

- **Type-Safe Logging**: Full TypeScript support with comprehensive type definitions
- **Structured Logging**: JSON logs in production, pretty logs in development
- **CLS Integration**: Automatic request-scoped context via `@sklv-labs/ts-nestjs-cls`
- **BaseError Support**: Respects `loggable` flag and provides structured error logging
- **Multi-Transport**: HTTP, RPC, and WebSocket logging interceptors
- **Rich Context**: Automatic extraction of requestId, traceId, userId, and more
- **Security**: Automatic redaction of sensitive fields
- **OpenTelemetry**: Automatic trace context extraction
- **NestJS Native**: Built for NestJS with seamless integration
