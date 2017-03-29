# vscode-tslint
Integrates the [tslint](https://github.com/palantir/tslint) linter for the TypeScript language into VS Code.

Please refer to the tslint [documentation](https://github.com/palantir/tslint) for how to configure the linting rules.

# Prerequisites
The extension requires that tslint is installed either locally or globally.

>Tip: if you get the error that "failed to load tslint", but you have tslint installed locally,
then try to install tslint and its typescript dependency globally using `npm install -g tslint typescript`.

# Configuration options

- `tslint.enable` - enable/disable tslint.
- `tslint.jsEnable` - enable/disable tslint for .js files, default is `false`.
- `tslint.run` - run the linter `onSave` or `onType`, default is `onType`.
- `tslint.rulesDirectory` - an additional rules directory, for user-created rules.
- `tslint.configFile` - the configuration file that tslint should use instead of the default `tslint.json`.
- `tslint.ignoreDefinitionFiles` - control if TypeScript definition files should be ignored.
- `tslint.exclude` - configure glob patterns of file paths to exclude from linting.
- `tslint.validateWithDefaultConfig` - validate a file for which there was no custom tslint confguration found. The default is `false`.
- `tslint.nodePath` - use this setting load tslint from a different location than the current workspace or the globally installed npm modules`.
- `tslint.autoFixOnSave` - fix auto fixable warnings when a file is saved. This option is ignored when `files.autoSave` is set to `afterDelay`.

# Auto fixing

The extension supports automatic fixing of warnings as support by tslint. For warnings which support an auto fix, a light bulb is shown when the cursor is positioned inside the warning's range. You can apply the quick fix by either:
* clicking the light bulb appearing or by executing the `Quick Fix`, when the mouse is over the errornous code
* or using the command `Fix all auto-fixable problems`.

**Notice** overlapping auto fixes are currently not supported [#164](https://github.com/Microsoft/vscode-tslint/issues/164).

# ProblemPatterns and ProblemMatchers

The extension contributes a `tslint4` `ProblemPattern` and a corresponding `tslint4` `ProblemMatcher`. You can use these variables when defining a tslint task in your `task.json` file. See the next section for an example.

# Using the extension with tasks running tslint

The extension lints an individual file only. If you want to lint your entire workspace or project and want to see
the warnings in the `Problems` panel, then you can:
- use a task runner like gulp that runs tslint across the entire project
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

Next define a Task which runs the gulp task with a problem matcher that extracts the tslint errors into warnings.

```json
{
    "version": "2.0.0",
    "command": "gulp",
    "isShellCommand": true,
    "tasks": [
        {
            "taskName": "tslint",
            "args": [],
            "problemMatcher": "$tslint4"
        }
    ]
}
```
>Notice: you must set the `owner` attribute to `tslint`. Then the warnings extracted by the problem matcher go into the same collection
as the warnings produced by this extension. In this way you will not see duplicates.

Finally, when you then run the `tslint` task you will see the warnings produced by the gulp task in the `Problems` panel.

This is an [example setup](https://github.com/Microsoft/vscode-tslint/tree/master/tslint-tests).

