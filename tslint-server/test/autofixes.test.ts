import * as assert from 'assert';
import { AutoFix, getAllNonOverlappingFixes } from '../src/server';
import { TSLintAutofixEdit } from '../src/fixer';

import * as server from 'vscode-languageserver';

function pos(line, char): server.Position {
  return server.Position.create(line, char);
}

function range(startLine, startChar, endLine, endChar): [server.Position, server.Position] {
  let start = pos(startLine, startChar);
  let end = pos(endLine, endChar);
  return [start, end];
}

function autoFixEdit(startLine, startChar, endLine, endChar): TSLintAutofixEdit {
  return {
    range: range(startLine, startChar, endLine, endChar),
    text: ''
  };
}

function autofix(startLine, startChar, endLine, endChar): AutoFix {
  return {
    label: '',
    documentVersion: 1,
    problem: undefined,
    edits: [autoFixEdit(startLine, startChar, endLine, endChar)]
  };
}

describe('Array', () => {
  describe('overlaps()', () => {
    it('non overlapping fixes', ()=> {
      assert.equal(1, getAllNonOverlappingFixes([autofix(1, 0, 6, 0)]).length);
      assert.equal(1, getAllNonOverlappingFixes([autofix(1, 0, 6, 0), autofix(4, 9, 4, 9)]).length);
      assert.equal(1, getAllNonOverlappingFixes([autofix(1, 0, 1, 0), autofix(1, 0, 1, 0)]).length);
      assert.equal(1, getAllNonOverlappingFixes([autofix(1, 0, 6, 0), autofix(1, 0, 6, 0)]).length);
      assert.equal(1, getAllNonOverlappingFixes([autofix(1, 0, 6, 0), autofix(6, 0, 6, 0)]).length);
      assert.equal(2, getAllNonOverlappingFixes([autofix(1, 0, 6, 0), autofix(7, 0, 7, 0)]).length);
      assert.equal(2, getAllNonOverlappingFixes([autofix(1, 0, 6, 0), autofix(6, 1, 6, 1)]).length);
    });
  });
});