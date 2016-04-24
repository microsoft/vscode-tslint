export interface TsLintAutoFix {
	tsLintCode: string;
	tsLintMessage: string;
	autoFixMessage: string;
	autoFix(codeBefore: string): string;
}
export let tsLintAutoFixes: TsLintAutoFix[] = [];

/**
 * AutoFix rules are all in this file
 * each autoFix should support the interface TsLintAutoFix and added in this.tsLintAutoFixes
 *
 * the key to map tsLint problem and autofix rules is => tsLintMessage
 */
let autoFix: TsLintAutoFix;
autoFix = {
	tsLintCode: "one-line",
	tsLintMessage: "missing whitespace",
	autoFixMessage: "Add a whitespace",
	autoFix: (codeBefore: string): string => {
		let codeAfter = " " + codeBefore;
		return codeAfter;
	}
};
this.tsLintAutoFixes.push(autoFix);

autoFix = {
	tsLintCode: "one-line",
	tsLintMessage: "missing semicolon",
	autoFixMessage: "Add semicolon",
	autoFix: (codeBefore: string): string => {
		let codeAfter = codeBefore + ";";
		return codeAfter;
	}
};
this.tsLintAutoFixes.push(autoFix);

autoFix = {
	tsLintCode: "quotemark",
	tsLintMessage: "' should be \"",
	autoFixMessage: "Replace ' by \" ",
	autoFix: (codeBefore: string): string => {
		let codeAfter = "\"" + codeBefore.slice(1, codeBefore.length - 1) + "\"";
		return codeAfter;
	}
};
this.tsLintAutoFixes.push(autoFix);

autoFix = {
	tsLintCode: "no-trailing-whitespace",
	tsLintMessage: "trailing whitespace",
	autoFixMessage: "Trim whitespace",
	autoFix: (codeBefore: string): string => {
		let codeAfter = "";
		return codeAfter;
	}
};
this.tsLintAutoFixes.push(autoFix);

autoFix = {
	tsLintCode: "indent",
	tsLintMessage: "tab indentation expected",
	autoFixMessage: "Replace 4 spaces by 1 tab",
	autoFix: (codeBefore: string): string => {
		let codeAfter = "	";
		return codeAfter;
	}
};
this.tsLintAutoFixes.push(autoFix);

autoFix = {
	tsLintCode: "indent",
	tsLintMessage: "space indentation expected",
	autoFixMessage: "Replace 1 tab by 4 spaces",
	autoFix: (codeBefore: string): string => {
		let codeAfter = "    ";
		return codeAfter;
	}
};
this.tsLintAutoFixes.push(autoFix);

autoFix = {
	tsLintCode: "eofline",
	tsLintMessage: "file should end with a newline",
	autoFixMessage: "add new line",
	autoFix: (codeBefore: string): string => {
		let codeAfter = "\n";
		return codeAfter;
	}
};
this.tsLintAutoFixes.push(autoFix);
