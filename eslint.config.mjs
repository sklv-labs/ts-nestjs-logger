import nestjsEslint from '@sklv-labs/ts-dev-configs/eslint/nestjs';
import { defineConfig } from 'eslint/config';

export default defineConfig([
    ...nestjsEslint,
    {
        files: ['src/**/*.ts'],
        rules: {
            '@darraghor/nestjs-typed/provided-injected-should-match-factory-parameters': 'off',
            '@darraghor/nestjs-typed/factory-parameters-should-match-provided-dependencies': 'off',
            '@darraghor/nestjs-typed/injectable-should-be-provided': 'off',
        },
    },
]);
