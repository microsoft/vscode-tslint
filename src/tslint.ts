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
		rules: any;
		rulesDirectory: string;
		formatterDirectory: string;
	}
	[key: string]: any;
}

let settings: Settings = null;
let rulesDirectory: string = null;
let formatterDirectory: string = null;
let linter: any = null;

let DEFAULT_CONFIG = {
	"rules": {
		"curly": true,
		"indent": [true, 4],
		"no-duplicate-key": true,
		"no-duplicate-variable": true,
		"no-empty": true,
		"no-eval": true,
		"no-trailing-whitespace": true,
		"no-unreachable": true,
		"no-use-before-declare": true,
		"quotemark": [true, "double"],
		"semicolon": true
	}
};

let options: Lint.ILinterOptions = {
	formatter: "json",
	configuration: {},
	rulesDirectory: "customRules/",
	formattersDirectory: "customFormatters/"
};

let TSLINT_CONFIG = 'tslint.json';
let rulesCache: { [key: string]: any } = Object.create(null);


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
		rulesCache = Object.create(null);
		requestor.all();
	},
	onConfigurationChange(_settings: Settings, requestor: IValidationRequestor): void {
		settings = _settings;
		if (settings.tslint) {
			options.configuration.rules = settings.tslint.rules || {};
			rulesDirectory = settings.tslint.rulesDirectory || "";
			formatterDirectory = settings.tslint.formatterDirectory || "";
		}
		rulesCache = Object.create(null);
		requestor.all();
	},
	validate: (document: IDocument): Diagnostic[] => {
		try {
			let uri = document.uri;
			let fsPath = Files.uriToFilePath(uri);
			let contents = document.getText();

			if (fsPath) {
				options = rulesCache[fsPath];
				if (!options) {
					options = readOptions(fsPath);
					rulesCache[fsPath] = options;
				}
			} else {
				options = rulesCache[''];
				if (!options) {
					options = readOptions(fsPath);
					rulesCache[''] = options;
				}
			}

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

function readOptions(fsPath: string = null): any {

	function isWindows(): boolean {
		return process.platform === 'win32';
	}

	function locateFile(directory: string, fileName: string) {
		let parent = directory;
		do {
			directory = parent;
			let location = path.join(directory, fileName);
			if (fs.existsSync(location)) {
				return location;
			}
			parent = path.dirname(directory);
		} while (parent !== directory);
		return undefined;
	};

	function stripComments(content: string): string {
		/**
		 * First capturing group mathes double quoted string
		 * Second matches singler quotes string
		 * Thrid matches block comments
		 * Fourth matches line comments
		 */
		var regexp: RegExp = /("(?:[^\\\"]*(?:\\.)?)*")|('(?:[^\\\']*(?:\\.)?)*')|(\/\*(?:\r?\n|.)*?\*\/)|(\/{2,}.*?(?:(?:\r?\n)|$))/g;
		let result = content.replace(regexp, (match, m1, m2, m3, m4) => {
			// Only one of m1, m2, m3, m4 matches
			if (m3) {
				// A block comment. Replace with nothing
				return "";
			} else if (m4) {
				// A line comment. If it ends in \r?\n then keep it.
				let length = m4.length;
				if (length > 2 && m4[length - 1] === '\n') {
					return m4[length - 2] === '\r' ? '\r\n' : '\n';
				} else {
					return "";
				}
			} else {
				// We match a string
				return match;
			}
		});
		return result;
	};

	function readJsonFile(file: string) {
		try {
			return JSON.parse(stripComments(fs.readFileSync(file).toString()));
		}
		catch (err) {
			throw new LanguageWorkerError("Can't load JSHint configuration from file " + file + ". Please check the file for syntax errors.", MessageKind.Show);
		}
	}

	function getUserHome() {
		return process.env[isWindows() ? 'USERPROFILE' : 'HOME'];
	}

	if (jshintSettings.config && fs.existsSync(jshintSettings.config)) {
		return readJsonFile(jshintSettings.config);
	}

	if (fsPath) {
		let packageFile = locateFile(fsPath, 'package.json');
		if (packageFile) {
			let content = readJsonFile(packageFile);
			if (content.jshintConfig) {
				return content.jshintConfig;
			}
		}

		let configFile = locateFile(fsPath, TSLINT_CONFIG);
		if (configFile) {
			return readJsonFile(configFile);
		}
	}

	let home = getUserHome();
	if (home) {
		let file = path.join(home, TSLINT_CONFIG);
		if (fs.existsSync(file)) {
			return readJsonFile(file);
		}
	}
	return jshintSettings;
};

runSingleFileValidator(process.stdin, process.stdout, validator);