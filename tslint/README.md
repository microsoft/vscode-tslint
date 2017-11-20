# vscode-tslint

Integrates the [tslint](https://github.com/palantir/tslint) linter for the TypeScript language into VS Code.

Please refer to the tslint [documentation](https://github.com/palantir/tslint) for how to configure the linting rules.

## Prerequisites

The extension requires that the `tslint` and `typescript` modules are installed either locally or globally. The extension will use the tslint module that is installed closest to the linted file. To install tslint and typescript globally you can run `npm install -g tslint typescript`.

## FAQ

- The `no-unused-variable` rule doesn't report warnings any more?

Since tslint version 5 the rule [no-unused-variable](https://palantir.github.io/tslint/rules/no-unused-variable/) rule requires type information. Rules with type information are currently not supported by vscode-tslint, pls see [issue #70](https://github.com/Microsoft/vscode-tslint/issues/70#issuecomment-241041929). The recommended work around is to enable the TypeScript compiler options `noUnusedLocals` and `noUnusedParameters` in your `tsconfig.json` file.

tsconfig.json

```json
{
    "compilerOptions": {
        "noUnusedLocals": true,
        "noUnusedParameters": true,
        ...
	}
}
```

- How can I use tslint rules that require type information

The recommended way is to run tslint manually on your project from a [task](https://code.visualstudio.com/docs/editor/tasks). To see the lint warnings in the Problems panel you can associate the task with a [Problem matcher](https://code.visualstudio.com/docs/editor/tasks#_processing-task-output-with-problem-matchers) as described in the section [below](#Using-the-extension-with-tasks-running-tslint).

- First linting is very slow [#287](https://github.com/Microsoft/vscode-tslint/issues/287)

When you have installed tslint globally using `npm install -g` then you can get hit by a performance issue in npm. The command to determine the location of the global node modules can be very slow with version 5 of npm. This problem could not be reproduce wiht npm version 4.2. You can work around this issue by:

1. installing tslint locally for you project using `npm install tslint`

1. define the location of the global node_modules folder using the `tslint.nodePath` setting.

## Trouble shooting

Open the tslint output log using the command `TSLint: Show Output`. Verify that there is no error message in the shown log.


You can enable more tracing output by adding the setting "tslint.trace.server" with a value of "verbose" or "messages".

If this doesn't
help then please file an [issue](https://github.com/Microsoft/vscode-tslint/issues/new) and include the trace output produced when running with the setting "tslint.trace.server" set to "verbose".

## Configuration options

**Notice** this configuration settings allow you to configure the behaviour of the vscode-tslint extension. To configure rules and tslint options you should use the `tslint.json` file.

- `tslint.enable` - enable/disable tslint.
- `tslint.jsEnable` - enable/disable tslint for .js files, default is `false`.
- `tslint.run` - run the linter `onSave` or `onType`, default is `onType`.
- `tslint.rulesDirectory` - an additional rules directory, for user-created rules.
- `tslint.configFile` - the configuration file that tslint should use instead of the default `tslint.json`.
- `tslint.ignoreDefinitionFiles` - control if TypeScript definition files should be ignored.
- `tslint.exclude` - configure glob patterns of file paths to exclude from linting. The pattern is matched against the **absolute path** of the linted file.
- `tslint.validateWithDefaultConfig` - validate a file for which no custom tslint configuration was found. The default is `false`.
- `tslint.nodePath` - custom path to node modules directory, used to load tslint from a different location than the default of the current workspace or the global node modules directory.
- `tslint.autoFixOnSave` -  turns auto fix on save on or off, or defines an array of rules (e.g. [`no-var-keyword`]) to auto fix on save. **Note:** Auto-fixing is only done when manually saving a file. It is not performed when the file is automatically saved based on the `files.autoSave` setting. Executing a manual save on an already-saved document will trigger auto-fixing.
- `tslint.alwaysShowStatus` - always show the `TSLint` status bar item and not only when there are errors. The default is `false`.
- `tslint.alwaysShowRuleFailuresAsWarnings` - always show rule failures as warnings, ignoring the severity configuration in the `tslint.json` configuration.
- `tslint.packageManager`: use this package manager to locate the `tslint` and `typescript` modules. Valid values are `"npm"` or `"yarn"`. This setting is only consulted when the modules are installed globally.

## Auto-fixing

The extension supports automatic fixing of warnings to the extent supported by tslint. For warnings which support an auto-fix, a light bulb is shown when the cursor is positioned inside the warning's range. You can apply the quick fix by either:

- clicking the light bulb appearing or by executing the `Quick Fix`, when the mouse is over the erroneous code
- or using the command `Fix all auto-fixable problems`.

When there are overlapping auto fixes a user will have to trigger `Fix all auto-fixable problems` more than once.

## ProblemPatterns and ProblemMatchers

The extension contributes a `tslint4` and a `tslint5` `ProblemMatcher` and corresponding problem patterns. You can use these variables when defining a tslint task in your `task.json` file. The `tslint5` problem matcher matches the rule severities introduced in version 5 of tslint.

The problem matcher is defined as follows:

```json
{
    "name": "tslint5",
    "owner": "tslint",
    "applyTo": "closedDocuments",
    "fileLocation": "absolute",
    "severity": "warning",
    "pattern": "$tslint5"
},
```

The meaning of the different attributes is:

- the `owner` attribute is set to `tslint` so that the warnings extracted by the problem matcher go into the same collection as the warnings produced by this extension. This will prevent showing duplicate warnings.

- the `applyTo` attribute is defined so that the problem matcher only runs on documents that are not open in an editor. An open document is already validated by the extension as the user types.
- the `fileLocation` is taken as an absolute path. This is correct for the output from `gulp`. When tslint is launched on the command line directly or from a package.json script then the file location is reported relative and you need to overwrite the value of this attribute (see below).
- the `severity` defaults to `warning` unless the rule is configured to report errors.

You can easily overwrite the value of these attributes. The following examples overwrites the `fileLocation` attribute to use the problem matcher when tslint is run on the command line or from a package.json script:

```json
"problemMatcher": {
    "base": "$tslint5",
    "fileLocation": "relative"
}
```

See the next section for an example.

## Using the extension with tasks running tslint

The extension lints an individual file only. If you want to lint your entire workspace or project and want to see
the warnings in the `Problems` panel, then you can:

- use gulp that or define a script inside the `package.json` that runs tslint across your project.

- define a VS Code [task](https://code.visualstudio.com/docs/editor/tasks) with a [problem matcher (https://code.visualstudio.com/docs/editor/tasks#_processing-task-output-with-problem-matchers) that extracts VS Code warnings from the tslint output.

For example, here is an excerpt from a package.json file that defines a script to run tslint:

```json
{
  "name": "tslint-script-demo",
  "version": "1.0.0",
  "scripts": {
    "lint": "tslint tests/*.ts -t verbose"
  },
  "devDependencies": {
    "typescript": "^2.2.2",
    "tslint": "^5.0.0"
  }
}

```

Next, define a Task which runs the npm script with a problem matcher that extracts the tslint errors into warnings.

```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "type": "npm",
            "script": "lint",
            "problemMatcher": {
                "base": "$tslint5",
                "fileLocation": "relative"
            }
        }
    ]
}
```

Finally, when you then run the `tslint` task you will see the warnings produced by the npm script in the `Problems` panel and you can navigate to the errors from there.

Here is the complete setup [example setup](https://github.com/Microsoft/vscode-tslint/tree/master/tslint-tests).
