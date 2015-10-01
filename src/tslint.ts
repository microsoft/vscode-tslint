/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';

import { runSingleFileValidator, SingleFileValidator, InitializeResponse, IValidationRequestor, IDocument, Diagnostic, Files, FileEvent, LanguageWorkerError, MessageKind } from 'vscode-languageworker';

import fs = require('fs');
import path = require('path');

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

function makeDiagnostic(problem: any): Diagnostic {
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

let validator: SingleFileValidator = {
	initialize: (rootFolder: string): Thenable<InitializeResponse> => {
		return Files.resolveModule(rootFolder, 'tslint').then((value) => {
			linter = value;
			return null;
		}, (error) => {
			return Promise.reject({
				success: false,
				message: 'Failed to load tslint library. Please install tslint in your workspace folder using \'npm install tslint\' and then press Retry.',
				retry: true
			});
		});
	},

	onFileEvents(changes: FileEvent[], requestor: IValidationRequestor): void {
		flushConfigCache();
		requestor.all();
	},

	onConfigurationChange(_settings: Settings, requestor: IValidationRequestor): void {
		settings = _settings;
		if (settings.tslint) {
			rulesDirectory = settings.tslint.rulesDirectory;
			formatterDirectory = settings.tslint.formatterDirectory;
		}
		flushConfigCache();
		requestor.all();
	},

	validate: (document: IDocument): Diagnostic[] => {
		try {
			let uri = document.uri;
			let fsPath = Files.uriToFilePath(uri);
			let contents = document.getText();

			options.configuration = getConfiguration(fsPath);
			let ll = new linter(fsPath, contents, options);
			let result = ll.lint();

			let diagnostics: Diagnostic[] = [];
			if (result.failureCount > 0) {
				let problems: any[] = JSON.parse(result.output);
				problems.forEach(each => {
					diagnostics.push(makeDiagnostic(each));
				});
			}
			return diagnostics;
		} catch (err) {
			let message: string = null;
			if (typeof err.message === 'string' || err.message instanceof String) {
				message = <string>err.message;
				throw new Error(message);
			}
			throw err;
		}
	}
};

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

runSingleFileValidator(process.stdin, process.stdout, validator);