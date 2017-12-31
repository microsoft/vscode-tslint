import * as server from 'vscode-languageserver';
import { ConfigurationRequest } from 'vscode-languageserver-protocol/lib/protocol.configuration.proposed';
import * as tslint from 'tslint'; // this is a dev dependency only
import { trace } from './utils';
import { InitializeParams } from 'vscode-languageserver/lib/main';

// Settings as defined in VS Code
export interface Settings {
	enable: boolean;
	jsEnable: boolean;
	rulesDirectory: string | string[];
	configFile: string;
	ignoreDefinitionFiles: boolean;
	exclude: string | string[];
	validateWithDefaultConfig: boolean;
	nodePath: string | undefined;
	run: 'onSave' | 'onType';
	alwaysShowRuleFailuresAsWarnings: boolean;
	alwaysShowStatus: boolean;
	autoFixOnSave: boolean | string[];
	packageManager: 'npm' | 'yarn';
	trace: any;
	workspaceFolderPath: string | undefined;
}

export interface Configuration {
	linterConfiguration: tslint.Configuration.IConfigurationFile | undefined;
	isDefaultLinterConfig: boolean;
}

class SettingsCache {
	uri: string | undefined;
	promise: Promise<Settings> | undefined;

	constructor() {
		this.uri = undefined;
		this.promise = undefined;
	}

	async get(connection: server.IConnection, uri: string): Promise<Settings> {
		if (uri === this.uri) {
			trace(connection, 'SettingsCache: cache hit for ' + this.uri);
			return this.promise!;
		}
		if (scopedSettingsSupport) {
			this.uri = uri;
			return this.promise = new Promise<Settings>(async (resolve, _reject) => {
				trace(connection, 'SettingsCache: cache updating cache for' + this.uri);
				let configRequestParam = { items: [{ scopeUri: uri, section: 'tslint' }] };
				let settings = await connection.sendRequest(ConfigurationRequest.type, configRequestParam);
				resolve(settings[0]);
			});
		}
		this.promise = Promise.resolve(globalSettings);
		return this.promise;
	}

	flush() {
		this.uri = undefined;
		this.promise = undefined;
	}
}

class ConfigCache {
	filePath: string | undefined;
	configuration: Configuration | undefined;

	constructor() {
		this.filePath = undefined;
		this.configuration = undefined;
	}

	set(path: string, configuration: Configuration) {
		this.filePath = path;
		this.configuration = configuration;
	}

	get(forPath: string): Configuration | undefined {
		if (forPath === this.filePath) {
			return this.configuration;
		}
		return undefined;
	}

	isDefaultLinterConfig(): boolean {
		if (this.configuration) {
			return this.configuration.isDefaultLinterConfig;
		}
		return false;
	}

	flush() {
		this.filePath = undefined;
		this.configuration = undefined;
	}
}
export let configCache = new ConfigCache();
export let settingsCache = new SettingsCache();
let globalSettings: Settings = <Settings>{};
let scopedSettingsSupport = false;

export function setGlobalSettings(settings: Settings) {
	globalSettings = settings;
}

export function getSettingsSupport(params: InitializeParams) {
	
	function hasClientCapability(name: string) {
		let keys = name.split('.');
		let c = params.capabilities;
		for (let i = 0; c && i < keys.length; i++) {
			c = c[keys[i]];
		}
		return !!c;
	}
	scopedSettingsSupport = hasClientCapability('workspace.configuration');
}