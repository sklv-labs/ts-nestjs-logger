/**
 * Constants for logging configuration
 */

/**
 * Default sensitive keys to redact from logs
 */
export const SENSITIVE_KEYS = [
  'password',
  'token',
  'authorization',
  'secret',
  'apiKey',
  'apikey',
  'cookie',
  'session',
  'set-cookie',
] as const;

/**
 * Default Pino redact paths
 */
export const DEFAULT_REDACT_PATHS = [
  'password',
  'token',
  'authorization',
  'secret',
  'apiKey',
  'apikey',
  'cookie',
  'session',
] as const;

/**
 * Default HTTP paths to skip logging
 */
export const DEFAULT_SKIP_PATHS = ['/health', '/metrics'] as const;

/**
 * Default maximum body length for logging
 */
export const DEFAULT_MAX_BODY_LENGTH = 1000;

/**
 * Internal NestJS/framework classes to skip when extracting context
 */
export const INTERNAL_CLASSES = new Set([
  'Array',
  'Object',
  'Function',
  'Promise',
  'Logger',
  'LoggerService',
  'NestLogger',
  'Console',
  'Module',
  'InstanceLoader',
  'NestFactory',
  'NestApplication',
  'NestApplicationContext',
  'Router',
  'RouterExplorer',
  'RoutesResolver',
  'Injector',
  'ModuleRef',
  'Reflector',
  'MetadataScanner',
  'DependenciesScanner',
  'ModuleCompiler',
  'NestContainer',
  'ContextIdFactory',
  'ContextId',
  'ModuleTokenFactory',
  'ModuleDefinition',
  'UnknownModule',
  'UndefinedModule',
  'DynamicModule',
  'StaticModule',
  'AsyncLocalStorage',
  'AsyncResource',
  'EventEmitter',
  'Stream',
  'Readable',
  'Writable',
  'Transform',
  'Duplex',
  'PassThrough',
  'OperatorSubscriber', // RxJS internal
  'Subscriber', // RxJS internal
  'Observable', // RxJS internal
]);

/**
 * Internal method names to skip
 */
export const INTERNAL_METHODS = new Set([
  'forEach',
  'map',
  'filter',
  'reduce',
  'find',
  'some',
  'every',
  'call',
  'apply',
  'bind',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'constructor',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  '__proto__',
  'next', // RxJS
  'error', // RxJS
  'complete', // RxJS
  'subscribe', // RxJS
  'pipe', // RxJS
  'tap', // RxJS
  'catchError', // RxJS
]);

/**
 * Invalid context values to filter out
 */
export const INVALID_CONTEXT_VALUES = new Set([
  'Array',
  'forEach',
  'Object',
  'OperatorSubscriber',
  'Subscriber',
]);
