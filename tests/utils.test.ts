import { test, describe } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';
import { resolveOutputDir, sanitizeFilename } from '../src/pesu-client.js';

describe('Utility Functions and Edge Cases', () => {
  describe('resolveOutputDir', () => {
    test('defaults to ./downloads in current working directory when dir is omitted', () => {
      const res = resolveOutputDir();
      assert.strictEqual(res, path.join(process.cwd(), 'downloads'));
    });

    test('defaults to ./downloads when explicit "./downloads" is passed', () => {
      const res = resolveOutputDir('./downloads');
      assert.strictEqual(res, path.join(process.cwd(), 'downloads'));
    });

    test('expands home directory with "~/" prefix', () => {
      const res = resolveOutputDir('~/Documents/pesu_files');
      assert.strictEqual(res, path.join(os.homedir(), 'Documents/pesu_files'));
    });

    test('expands lone "~" to home directory', () => {
      const res = resolveOutputDir('~');
      assert.strictEqual(res, os.homedir());
    });

    test('resolves relative path', () => {
      const res = resolveOutputDir('output/subfolder');
      assert.strictEqual(res, path.resolve('output/subfolder'));
    });

    test('preserves absolute path', () => {
      const abs = path.resolve('/tmp/pesu_test_dir');
      const res = resolveOutputDir(abs);
      assert.strictEqual(res, abs);
    });
  });

  describe('sanitizeFilename', () => {
    test('preserves standard filename', () => {
      const res = sanitizeFilename('PESU_Notes_2026.pdf');
      assert.strictEqual(res, 'PESU_Notes_2026.pdf');
    });

    test('replaces Windows illegal characters with underscores', () => {
      // Illegal characters: < > : " / \ | ? *
      const raw = 'UE23CS351A: DBMS <Unit "1"> | Slides? *Final*.pdf';
      const clean = sanitizeFilename(raw);
      assert.strictEqual(clean, 'UE23CS351A_ DBMS _Unit _1__ _ Slides_ _Final_.pdf');
      assert.strictEqual(/[<>:"/\\|?*]/.test(clean), false);
    });

    test('replaces control characters', () => {
      const raw = 'doc\x00\x07\x1F.pdf';
      const clean = sanitizeFilename(raw);
      assert.strictEqual(clean, 'doc___.pdf');
    });

    test('strips leading and trailing dots and spaces', () => {
      const raw = '   ...notes_unit_1.pdf...   ';
      const clean = sanitizeFilename(raw);
      assert.strictEqual(clean, 'notes_unit_1.pdf');
    });

    test('truncates extremely long filename while preserving extension', () => {
      const longBase = 'A'.repeat(250);
      const raw = `${longBase}.pdf`;
      const clean = sanitizeFilename(raw);
      assert.ok(clean.length <= 180, `Expected clean length <= 180, got ${clean.length}`);
      assert.ok(clean.endsWith('.pdf'));
      assert.strictEqual(clean.slice(0, 10), 'AAAAAAAAAA');
    });

    test('falls back to "document.pdf" for empty string or purely illegal chars', () => {
      assert.strictEqual(sanitizeFilename(''), 'document.pdf');
      assert.strictEqual(sanitizeFilename('   ...   '), 'document.pdf');
      assert.strictEqual(sanitizeFilename(':::***???'), 'document.pdf');
    });
  });
});
