/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';

import * as server from 'vscode-languageserver';

// Settings as defined in VS Code
interface Settings {
	tslint: {
		enable: boolean;
		rulesDirectory: string;
		configFile: string;
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

let configCache = {
	filePath: <string>null,
	configuration: <any>null
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
		configuration: linter.findConfiguration(configFileName, filePath)
	};
	return configCache.configuration;
}

function flushConfigCache() {
	configCache = {
		filePath: null,
		configuration: null
	};
}

function getErrorMessage(err: any, document: server.ITextDocument): string {
	let result: string = null;
	if (typeof err.message === 'string' || err.message instanceof String) {
		result = `vscode-tslint: ${<string>err.message}`;
	} else {
		result = `vscode-tslint: An unknown error occured while validating file: ${server.Files.uriToFilePath(document.uri) }`;
	}
	return result;
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
		doValidate(connection, document);
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

function doValidate(conn: server.IConnection, document: server.ITextDocument): void {
	try {
		let uri = document.uri;
		let fsPath = server.Files.uriToFilePath(uri);
		if (!fsPath) { // don't lint inmemory documents
			return;
		}
		let contents = document.getText();

		options.configuration = getConfiguration(fsPath, configFile);
		let ll = new linter(fsPath, contents, options);
		let result = ll.lint();

		let diagnostics: server.Diagnostic[] = [];
		if (result.failureCount > 0) {
			let problems: any[] = JSON.parse(result.output);
			problems.forEach(each => {
				diagnostics.push(makeDiagnostic(each));
			});
		}
		conn.sendDiagnostics({ uri, diagnostics });
	} catch (err) {
		let message: string = null;
		if (typeof err.message === 'string' || err.message instanceof String) {
			message = <string>err.message;
			throw new Error(message);
		}
		throw err;
	}
}

// A text document has changed. Validate the document.
documents.onDidChangeContent((event) => {
	// the contents of a text document has changed
	validateTextDocument(connection, event.document);
});

// The VS Code tslint settings have changed. Revalidate all documents.
connection.onDidChangeConfiguration((params) => {
	flushConfigCache();
	settings = params.settings;

	if (settings.tslint) {
		options.rulesDirectory = settings.tslint.rulesDirectory || null;
		configFile = settings.tslint.configFile || null;
	}
	validateAllTextDocuments(connection, documents.all());
});

// The watched tslint.json has changed. Revalidate all documents.
connection.onDidChangeWatchedFiles((params) => {
	flushConfigCache();
	validateAllTextDocuments(connection, documents.all());
});

connection.listen();
