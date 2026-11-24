// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The one version compare the suites share: `gte(a, b)` is a >= b for dotted x.y.z versions. A plain module, not a test
 * file, so a suite that imports it does not run another suite's tests (the .fake.ts lesson in CLAUDE.md).
 */
export function gte(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] > pb[i]; }
  return true;
}
