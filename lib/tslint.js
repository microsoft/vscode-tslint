/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';
var vscode_languageworker_1 = require('vscode-languageworker');
var settings = null;
var rulesDirectory = null;
var formatterDirectory = null;
var linter = null;
var options = {
    formatter: "json",
    configuration: {},
    rulesDirectory: undefined,
    formattersDirectory: undefined
};
var configCache = {
    filePath: null,
    configuration: null
};
function makeDiagnostic(problem) {
    return {
        message: problem.failure,
        start: {
            line: problem.startPosition.line + 1,
            character: problem.startPosition.character + 1
        },
        end: {
            line: problem.endPosition.line + 1,
            character: problem.endPosition.character + 1
        },
        code: problem.ruleName
    };
}
var validator = {
    initialize: function (rootFolder) {
        return vscode_languageworker_1.Files.resolveModule(rootFolder, 'tslint').then(function (value) {
            linter = value;
            return null;
        }, function (error) {
            return Promise.reject({
                success: false,
                message: 'Failed to load tslint library. Please install tslint in your workspace folder using \'npm install tslint\' and then press Retry.',
                retry: true
            });
        });
    },
    onFileEvents: function (changes, requestor) {
        flushConfigCache();
        requestor.all();
    },
    onConfigurationChange: function (_settings, requestor) {
        settings = _settings;
        if (settings.tslint) {
            rulesDirectory = settings.tslint.rulesDirectory;
            formatterDirectory = settings.tslint.formatterDirectory;
        }
        flushConfigCache();
        requestor.all();
    },
    validate: function (document) {
        try {
            var uri = document.uri;
            var fsPath = vscode_languageworker_1.Files.uriToFilePath(uri);
            var contents = document.getText();
            options.configuration = getConfiguration(fsPath);
            var ll = new linter(fsPath, contents, options);
            var result = ll.lint();
            var diagnostics = [];
            if (result.failureCount > 0) {
                var problems = JSON.parse(result.output);
                problems.forEach(function (each) {
                    diagnostics.push(makeDiagnostic(each));
                });
            }
            return diagnostics;
        }
        catch (err) {
            var message = null;
            if (typeof err.message === 'string' || err.message instanceof String) {
                message = err.message;
                throw new Error(message);
            }
            throw err;
        }
    }
};
function getConfiguration(filePath) {
    if (configCache.configuration && configCache.filePath === filePath) {
        return configCache.configuration;
    }
    configCache = {
        filePath: filePath,
        configuration: linter.findConfiguration(null, filePath)
    };
    return configCache.configuration;
}
function flushConfigCache() {
    configCache = {
        filePath: null,
        configuration: null
    };
}
vscode_languageworker_1.runSingleFileValidator(process.stdin, process.stdout, validator);
