// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The source lines of a tree that match a pattern, read from the files themselves: the guards that once ran `git grep`
// hold in a tree with no .git (rpmbuild's %check unpacks the release tarball, #207) and in one git refuses to read (a
// CI container whose checkout another user owns: "detected dubious ownership"). git grep reads only tracked files;
// here the build's own products are left out by name instead: the directories .gitignore names (node_modules, dist,
// build, __pycache__) and .git itself, and a file holding a NUL byte is not text.
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The directory names no source file is under: what the build writes and what git keeps. */
const NOT_SOURCE = new Set(['.git', 'node_modules', 'dist', 'build', '__pycache__']);

/** Every regular file at or under `rel` of `root`, as paths relative to `root` ('.' for the whole tree). */
export function treeFiles(root, rel = '.') {
  const at = join(root, rel);
  if (!existsSync(at)) return [];
  const st = lstatSync(at);
  if (st.isFile()) return [rel];
  if (!st.isDirectory()) return [];
  return readdirSync(at).sort().filter((n) => !NOT_SOURCE.has(n))
    .flatMap((n) => treeFiles(root, rel === '.' ? n : `${rel}/${n}`));
}

/** The lines of the files under `paths` of `root` that match `pattern`, `path:line:text` each, git grep's -n form;
 * `exclude` holds paths relative to `root` (a file, or a directory and all under it) left out. */
export function treeGrep(root, pattern, paths = ['.'], exclude = []) {
  const excluded = (rel) => exclude.some((x) => rel === x || rel.startsWith(`${x}/`));
  let out = '';
  for (const rel of paths.flatMap((p) => treeFiles(root, p)).filter((r) => !excluded(r))) {
    const text = readFileSync(join(root, rel), 'utf8');
    if (text.includes('\0')) continue;
    text.split('\n').forEach((line, i) => {
      if (pattern.test(line)) out += `${rel}:${i + 1}:${line}\n`;
    });
  }
  return out;
}
