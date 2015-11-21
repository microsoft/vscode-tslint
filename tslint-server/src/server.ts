/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';

import * as fs from 'fs';
import * as path from 'path';

import * as server from 'vscode-languageserver';

interface Settings {
	tslint: {
		enable: boolean;
		rulesDirectory: string;
		formatterDirectory: string
	}
}

let settings: Settings = null;
let rulesDirectory: string = null;
let formatterDirectory: string = null;
let linter: any = null;

let options: Lint.ILinterOptions = {
	formatter: "json",
	configuration: {},
	rulesDirectory: undefined,
	formattersDirectory: undefined
};

let configCache = {
	filePath: <string>null,
	configuration: <any>null
}

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
		code: problem.ruleName
	};
}

function getConfiguration(filePath: string): any {
	if (configCache.configuration && configCache.filePath === filePath) {
		return configCache.configuration;
	}
	configCache = {
		filePath: filePath,
		configuration: linter.findConfiguration(null, filePath)
	}
	return configCache.configuration;
}

function flushConfigCache() {
	configCache = {
		filePath: null,
		configuration: null
	}
}

function getErrorMessage(err: any, document: server.ITextDocument): string {
	let result: string = null;
	if (typeof err.message === 'string' || err.message instanceof String) {
		result = <string>err.message;
	} else {
		result = `An unknown error occured while validating file: ${server.Files.uriToFilePath(document.uri) }`;
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
	return server.Files.resolveModule(rootFolder, 'tslint').then((value): server.InitializeResult | server.ResponseError<server.InitializeError> => {
		linter = value;
		let result: server.InitializeResult = { capabilities: { textDocumentSync: documents.syncKind } };
		return result;
	}, (error) => {
		return Promise.reject(
			new server.ResponseError<server.InitializeError>(99,
				'Failed to load tslint library. Please install tslint in your workspace folder using \'npm install tslint\' and then press Retry.',
				{ retry: true }));
	});
});

function doValidate(connection: server.IConnection, document: server.ITextDocument): void {
	try {
		let uri = document.uri;
		let fsPath = server.Files.uriToFilePath(uri);
		let contents = document.getText();

		options.configuration = getConfiguration(fsPath);
		let ll = new linter(fsPath, contents, options);
		let result = ll.lint();

		let diagnostics: server.Diagnostic[] = [];
		if (result.failureCount > 0) {
			let problems: any[] = JSON.parse(result.output);
			problems.forEach(each => {
				diagnostics.push(makeDiagnostic(each));
			});
		}
		connection.sendDiagnostics({ uri, diagnostics });
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
		options.rulesDirectory = settings.tslint.rulesDirectory;
		options.formatterDirectory = settings.tslint.formatterDirectory;
	}
	validateAllTextDocuments(connection, documents.all());
});

// The watched tslint.json has changed. Revalidate all documents.
connection.onDidChangeWatchedFiles((params) => {
	flushConfigCache();
	validateAllTextDocuments(connection, documents.all());
});

connection.listen();
