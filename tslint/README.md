# vscode-tslint
Integrates the [tslint](https://github.com/palantir/tslint) linter for the TypeScript language into VS Code.

Please refer to the tslint [documentation](https://github.com/palantir/tslint) for how to configure the linting rules.

# Prerequisites
The extension requires that tslint is installed either locally or globally.

>Tip: if you get an error saying, "failed to load tslint", but you have tslint installed locally,
 try to install tslint and its typescript dependency globally using `npm install -g tslint typescript`.

# Configuration options

**Notice** this configuration settings allow you to configure the behaviour of the vscode-tslint extension. To configure rules and tslint options you should use the `tslint.json` file.

- `tslint.enable` - enable/disable tslint.
- `tslint.jsEnable` - enable/disable tslint for .js files, default is `false`.
- `tslint.run` - run the linter `onSave` or `onType`, default is `onType`.
- `tslint.rulesDirectory` - an additional rules directory, for user-created rules.
- `tslint.configFile` - the configuration file that tslint should use instead of the default `tslint.json`.
- `tslint.ignoreDefinitionFiles` - control if TypeScript definition files should be ignored.
- `tslint.exclude` - configure glob patterns of file paths to exclude from linting. The pattern is matched against the absolute path of the linted file.
- `tslint.validateWithDefaultConfig` - validate a file for which no custom tslint configuration was found. The default is `false`.
- `tslint.nodePath` - custom path to node modules directory, used to load tslint from a different location than the default of the current workspace or the global node modules directory.
- `tslint.autoFixOnSave` - fix auto-fixable warnings when a file is saved. **Note:** Auto-fixing is only done when manually saving a file. It is not performed when the file is automatically saved based on the `files.autoSave` setting. Executing a manual save on an already-saved document will trigger auto-fixing.
- `tslint.alwaysShowRuleFailuresAsWarnings` - always show rule failures as warnings, ignoring the severity configuration in the `tslint.json` configuration.

# Auto-fixing

The extension supports automatic fixing of warnings to the extent supported by tslint. For warnings which support an auto-fix, a light bulb is shown when the cursor is positioned inside the warning's range. You can apply the quick fix by either:
* clicking the light bulb appearing or by executing the `Quick Fix`, when the mouse is over the erroneous code
* or using the command `Fix all auto-fixable problems`.

When there are overlapping auto fixes a user will have to trigger `Fix all auto-fixable problems` more than once.

# ProblemPatterns and ProblemMatchers

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
- the `owner` attribute is set to `tslint` so that the warnings extracted by the problem matcher go into the same collection
as the warnings produced by this extension. This will prevent showing duplicate warnings.
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

# Using the extension with tasks running tslint

The extension lints an individual file only. If you want to lint your entire workspace or project and want to see
the warnings in the `Problems` panel, then you can:
- use gulp that or define a script inside the `package.json` that runs tslint across your project.
- define a VS Code [task](https://code.visualstudio.com/docs/editor/tasks) with a [problem matcher](https://code.visualstudio.com/docs/editor/tasks#_processing-task-output-with-problem-matchers)
that extracts VS Code warnings from the tslint output.

Here is an example. Create a gulp task using `gulp-tslint` that you can then match
by a VS Code Task's problem matcher. In your `gulpfile.js` define a task like the one below:

```js
'use strict';
const gulp = require('gulp');
const gulp_tslint = require('gulp-tslint');

gulp.task('tslint', () => {
    gulp.src(['tests/*.ts'])
      .pipe(gulp_tslint({
          formatter: "prose"
      }))
      .pipe(gulp_tslint.report({
          emitError: false
      }));
});
```

Next, define a Task which runs the gulp task with a problem matcher that extracts the tslint errors into warnings.

```json
{
    "version": "2.0.0",
    "command": "gulp",
    "isShellCommand": true,
    "tasks": [
        {
            "taskName": "tslint",
            "args": [],
            "problemMatcher": "$tslint5"
        }
    ]
}
```

Finally, when you then run the `tslint` task you will see the warnings produced by the gulp task in the `Problems` panel.

Here is another [example setup](https://github.com/Microsoft/vscode-tslint/tree/master/tslint-tests) for a script inside the package.json.

