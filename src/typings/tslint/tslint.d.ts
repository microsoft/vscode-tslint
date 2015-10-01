

declare module Lint {
    interface LintResult {
        failureCount: number;
        failures: any;
        format: string;
        output: string;
    }
    interface ILinterOptions {
        configuration: any;
        formatter: string;
        formattersDirectory: string;
        rulesDirectory: string;
    }
    class Linter {
        static VERSION: string;
        private fileName;
        private source;
        private options;
        constructor(fileName: string, source: string, options: ILinterOptions);
        lint(): LintResult;
        private getRelativePath(directory);
        private containsRule(rules, rule);
    }
}
declare module "tslint" {
    import Linter = Lint.Linter;
    export = Linter;
}