import { DynamicModule, Global, Module, Provider, Type } from '@nestjs/common';
import { ClsModule, ClsService } from '@sklv-labs/ts-nestjs-cls';

import { LOGGER_OPTIONS } from './logger.constants';
import { LoggerContextService } from './logger.context';
import { LoggerService, LoggerModuleOptions } from './logger.service';

import type { ModuleMetadata } from '@nestjs/common/interfaces';

export interface LoggerModuleAsyncOptions<TFactoryArgs extends unknown[] = unknown[]> extends Pick<
  ModuleMetadata,
  'imports'
> {
  /**
   * Dependencies to inject into `useFactory` (e.g. `ConfigService`)
   */
  inject?: { [K in keyof TFactoryArgs]: Type<TFactoryArgs[K]> | string | symbol };
  /**
   * Factory returning the `LoggerModuleOptions` (sync or async)
   */
  useFactory: (...args: TFactoryArgs) => LoggerModuleOptions | Promise<LoggerModuleOptions>;
}

@Global()
@Module({})
export class LoggerModule {
  static forRoot(options: LoggerModuleOptions = {}): DynamicModule {
    const loggerOptionsProvider: Provider = {
      provide: LOGGER_OPTIONS,
      useValue: options,
    };

    const loggerContextServiceProvider: Provider = {
      provide: LoggerContextService,
      useFactory: (cls: ClsService) => {
        // ClsService is required - ClsModule must be imported
        return new LoggerContextService(cls);
      },
      inject: [ClsService],
    };

    const loggerServiceProvider: Provider = {
      provide: LoggerService,
      useFactory: (options: LoggerModuleOptions, loggerContext: LoggerContextService) => {
        return new LoggerService(options, loggerContext);
      },
      inject: [LOGGER_OPTIONS, LoggerContextService],
    };

    return {
      module: LoggerModule,
      imports: [ClsModule],
      providers: [loggerOptionsProvider, loggerContextServiceProvider, loggerServiceProvider],
      exports: [LoggerService, LoggerContextService],
    };
  }

  static forRootAsync<TFactoryArgs extends unknown[] = unknown[]>(
    options: LoggerModuleAsyncOptions<TFactoryArgs>
  ): DynamicModule {
    const loggerOptionsProvider: Provider = {
      provide: LOGGER_OPTIONS,
      useFactory: options.useFactory,
      inject: (options.inject ?? []) as Array<Type<unknown> | string | symbol>,
    };

    const loggerContextServiceProvider: Provider = {
      provide: LoggerContextService,
      useFactory: (cls: ClsService) => {
        // ClsService is required - ClsModule must be imported
        return new LoggerContextService(cls);
      },
      inject: [ClsService],
    };

    const loggerServiceProvider: Provider = {
      provide: LoggerService,
      useFactory: (loggerOptions: LoggerModuleOptions, loggerContext: LoggerContextService) =>
        new LoggerService(loggerOptions, loggerContext),
      inject: [LOGGER_OPTIONS, LoggerContextService],
    };

    return {
      module: LoggerModule,
      imports: [ClsModule, ...(options.imports ?? [])],
      providers: [loggerOptionsProvider, loggerContextServiceProvider, loggerServiceProvider],
      exports: [LoggerService, LoggerContextService],
    };
  }
}
