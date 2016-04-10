/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';

import * as minimatch from 'minimatch';
import * as server from 'vscode-languageserver';
import * as fs from 'fs';

// Settings as defined in VS Code
interface Settings {
	tslint: {
		enable: boolean;
		rulesDirectory: string | string[];
		configFile: string;
<<<<<<< HEAD
=======
		ignoreDefinitionFiles: boolean;
		exclude: string | string[];
>>>>>>> Spacetech-master
		validateWithDefaultConfig: boolean;
	};
}

let settings: Settings = null;

let linter: typeof Lint.Linter = null;

let tslintNotFound =
	`Failed to load tslint library. Please install tslint in your workspace
folder using \'npm install tslint\' or \'npm install -g tslint\' and then press Retry.`;

// Options passed to tslint
let options: Lint.ILinterOptions = {
	formatter: "json",
	configuration: {},
	rulesDirectory: undefined,
	formattersDirectory: undefined
};
let configFile: string = null;
let configFileWatcher: fs.FSWatcher = null;

let configCache = {
	filePath: <string>null,
	configuration: <any>null,
	isDefaultConfig: false
};

function makeDiagnostic(problem: any): server.Diagnostic {
	return {
		severity: server.DiagnosticSeverity.Warning,
		message: problem.failure,
		range: {
			start: {
				line: problem.startPosition.line,
				character: problem.startPosition.character
			},
			end: {
				line: problem.endPosition.line,
				character: problem.endPosition.character
			},
		},
		code: problem.ruleName,
		source: 'tslint'
	};
}

function getConfiguration(filePath: string, configFileName: string): any {
	if (configCache.configuration && configCache.filePath === filePath) {
		return configCache.configuration;
	}
	configCache = {
		filePath: filePath,
		isDefaultConfig: linter.findConfigurationPath(configFileName, filePath) === undefined,
		configuration: linter.findConfiguration(configFileName, filePath)
	};
	return configCache.configuration;
}

function flushConfigCache() {
	configCache = {
		filePath: null,
		configuration: null,
		isDefaultConfig: false
	};
}

function getErrorMessage(err: any, document: server.ITextDocument): string {
	let errorMessage = `unknown error`;
	if (typeof err.message === 'string' || err.message instanceof String) {
		errorMessage = <string>err.message;
	}
	let fsPath = server.Files.uriToFilePath(document.uri);
	let message = `vscode-tslint: '${errorMessage}' while validating: ${fsPath} stacktrace: ${err.stack}`;
	return message;
}

function showConfigurationFailure(conn: server.IConnection, err: any) {
	let errorMessage = `unknown error`;
	if (typeof err.message === 'string' || err.message instanceof String) {
		errorMessage = <string>err.message;
	}
	let message = `vscode-tslint: Cannot read tslint configuration - '${errorMessage}'`;
	conn.window.showInformationMessage(message);
}

function validateAllTextDocuments(connection: server.IConnection, documents: server.ITextDocument[]): void {
	let tracker = new server.ErrorMessageTracker();
	documents.forEach(document => {
		try {
			validateTextDocument(connection, document);
		} catch (err) {
			tracker.add(getErrorMessage(err, document));
		}
	});
	tracker.sendErrors(connection);
}

function validateTextDocument(connection: server.IConnection, document: server.ITextDocument): void {
	try {
		let uri = document.uri;
		let diagnostics = doValidate(connection, document);
		connection.sendDiagnostics({ uri, diagnostics });
	} catch (err) {
		connection.window.showErrorMessage(getErrorMessage(err, document));
	}
}

let connection: server.IConnection = server.createConnection(process.stdin, process.stdout);
let documents: server.TextDocuments = new server.TextDocuments();

documents.listen(connection);

connection.onInitialize((params): Thenable<server.InitializeResult | server.ResponseError<server.InitializeError>> => {
	let rootFolder = params.rootPath;
	return server.Files.resolveModule(rootFolder, 'tslint').
		then((value): server.InitializeResult | server.ResponseError<server.InitializeError> => {
			linter = value;
			let result: server.InitializeResult = { capabilities: { textDocumentSync: documents.syncKind } };
			return result;
		}, (error) => {
			return Promise.reject(
				new server.ResponseError<server.InitializeError>(99,
					tslintNotFound,
					{ retry: true }));
		});
});

function doValidate(conn: server.IConnection, document: server.ITextDocument): server.Diagnostic[] {
	let uri = document.uri;
	let diagnostics: server.Diagnostic[] = [];

	let fsPath = server.Files.uriToFilePath(uri);
	if (!fsPath) {
		// tslint can only lint files on disk
		return diagnostics;
	}

	if (fileIsExcluded(fsPath)) {
		return diagnostics;
	}

	let contents = document.getText();

	try {
		options.configuration = getConfiguration(fsPath, configFile);
	} catch (err) {
		showConfigurationFailure(conn, err);
		return diagnostics;
	}

	if (settings && settings.tslint && settings.tslint.validateWithDefaultConfig === false && configCache.isDefaultConfig) {
		return diagnostics;
	}

	if (configCache.isDefaultConfig && settings.tslint.validateWithDefaultConfig === false) {
		return;
	}

	let result: Lint.LintResult;
	try { // protect against tslint crashes
		let tslint = new linter(fsPath, contents, options);
		result = tslint.lint();
	} catch (err) {
		// TO DO show an indication in the workbench
		conn.console.error(getErrorMessage(err, document));
		return diagnostics;
	}

	if (result.failureCount > 0) {
		let problems: any[] = JSON.parse(result.output);
		problems.forEach(each => {
			diagnostics.push(makeDiagnostic(each));
		});
	}
	return diagnostics;
}

function fileIsExcluded(path: string): boolean {
	function testForExclusionPattern(path: string, pattern: string): boolean {
		return minimatch(path, pattern)
	}

	if (settings && settings.tslint) {
		if (settings.tslint.ignoreDefinitionFiles) {
			if (minimatch(path, "**/*.d.ts")) {
				return true;
			}
		}

		if (settings.tslint.exclude) {
			if (Array.isArray(settings.tslint.exclude)) {
				for (var pattern of settings.tslint.exclude) {
					if (testForExclusionPattern(path, pattern)) {
						return true;
					}
				}
			}
			else if (testForExclusionPattern(path, <string>settings.tslint.exclude)) {
				return true;
			}
		}
	}
}

// A text document has changed. Validate the document.
documents.onDidChangeContent((event) => {
	// the contents of a text document has changed
	validateTextDocument(connection, event.document);
});

function tslintConfigurationValid(): boolean {
	try {
		documents.all().forEach((each) => {
			let fsPath = server.Files.uriToFilePath(each.uri);
			if (fsPath) {
				getConfiguration(fsPath, configFile);
			}
		});
	} catch (err) {
		return false;
	}
	return true;
}

// The VS Code tslint settings have changed. Revalidate all documents.
connection.onDidChangeConfiguration((params) => {
	flushConfigCache();
	settings = params.settings;

	if (settings.tslint) {
		options.rulesDirectory = settings.tslint.rulesDirectory || null;
		let newConfigFile = settings.tslint.configFile || null;
		if (configFile !== newConfigFile) {
			if (configFileWatcher) {
				configFileWatcher.close();
				configFileWatcher = null;
			}
			if (!fs.existsSync(newConfigFile)) {
				connection.window.showWarningMessage(`The file ${newConfigFile} refered to by 'tslint.configFile' does not exist`);
				configFile = null;
				return;
			}
			configFile = newConfigFile;
			if (configFile) {
				configFileWatcher = fs.watch(configFile, { persistent: false }, (event, fileName) => {
					validateAllTextDocuments(connection, documents.all());
				});
			}
		}
	}
	validateAllTextDocuments(connection, documents.all());
});

// The watched tslint.json has changed. Revalidate all documents, IF the configuration is valid.
connection.onDidChangeWatchedFiles((params) => {
	flushConfigCache();
	if (tslintConfigurationValid()) {
		validateAllTextDocuments(connection, documents.all());
	}
});

connection.listen();
