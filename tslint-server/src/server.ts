/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';

import * as server from 'vscode-languageserver';

import { Delayer } from './delayer';
import { trace, } from './utils';
import { validateTextDocument, validateAllTextDocuments, document2Library, tslintConfigurationValid } from './validation';
import { onCodeAction, AllFixesRequest, onAllFixesRequest } from './commands';
import { getSettingsSupport, settingsCache, configCache, setGlobalSettings } from './settings';

const validationDelayer = new Map<string, Delayer<void>>(); // key is the URI of the document


const connection: server.IConnection = server.createConnection(new server.IPCMessageReader(process), new server.IPCMessageWriter(process));
const documents: server.TextDocuments = new server.TextDocuments();

documents.listen(connection);


connection.onInitialize((params) => {
	getSettingsSupport(params);
	return {
		capabilities: {
			textDocumentSync: documents.syncKind,
			codeActionProvider: true
		}
	};
});


documents.onDidOpen(async (event) => {
	trace(connection, 'onDidOpen');
	triggerValidateDocument(event.document);
});

documents.onDidChangeContent(async (event) => {
	trace(connection, 'onDidChangeContent');
	let settings = await settingsCache.get(connection, event.document.uri);
	trace(connection, 'onDidChangeContent: settings' + settings);
	if (settings && settings.run === 'onType') {
		trace(connection, 'onDidChangeContent: triggerValidateDocument');
		triggerValidateDocument(event.document);
	}
	// clear the diagnostics when validating on save and when the document is modified
	else if (settings && settings.run === 'onSave') {
		connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
	}
});

documents.onDidSave(async (event) => {
	let settings = await settingsCache.get(connection, event.document.uri);
	if (settings && settings.run === 'onSave') {
		triggerValidateDocument(event.document);
	}
});

documents.onDidClose((event) => {
	// A text document was closed we clear the diagnostics
	trace(connection, 'onDidClose' + event.document.uri);
	connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
	document2Library.delete(event.document.uri);
});

function triggerValidateDocument(document: server.TextDocument) {
	let d = validationDelayer[document.uri];
	trace(connection, 'triggerValidation on ' + document.uri);
	if (!d) {
		d = new Delayer<void>(200);
		validationDelayer[document.uri] = d;
	}
	d.trigger(() => {
		trace(connection, 'trigger validateTextDocument');
		validateTextDocument(connection, document);
		delete validationDelayer[document.uri];
	});
}

// The VS Code tslint settings have changed. Revalidate all documents.
connection.onDidChangeConfiguration((params) => {
	trace(connection, 'onDidChangeConfiguraton');

	setGlobalSettings(params.settings);
	configCache.flush();
	settingsCache.flush();
	validateAllTextDocuments(connection, documents.all());
});

// The watched tslint.json has changed. Revalidate all documents, IF the configuration is valid.
connection.onDidChangeWatchedFiles((params) => {
	// Tslint 3.7 started to load configuration files using 'require' and they are now
	// cached in the node module cache. To ensure that the extension uses
	// the latest configuration file we remove the config file from the module cache.
	params.changes.forEach(element => {
		let configFilePath = server.Files.uriToFilePath(element.uri);
		if (configFilePath) {
			let cached = require.cache[configFilePath];
			if (cached) {
				delete require.cache[configFilePath];
			}
		}
	});

	configCache.flush();
	if (tslintConfigurationValid(connection, documents)) {
		validateAllTextDocuments(connection, documents.all());
	}
});

connection.onCodeAction(onCodeAction);



connection.onRequest(AllFixesRequest.type, (params) => onAllFixesRequest(connection, params));


connection.listen();
