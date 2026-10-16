#!/usr/bin/env node

// Parses the Mermaid diagrams of the Markdown file an Edit or Write touched and names the diagrams whose table links the edited file.
// https://code.claude.com/docs/en/hooks.md

import { relative, sep } from 'node:path';

import { diagramSyntax, linkedDiagrams } from './lib/diagrams.mts';
import { readEditedFile, report } from './lib/hook.mts';

await main();

async function main(): Promise<void> {
  // 1. Read the edited file and stay silent for one outside the project.
  const file = readEditedFile();

  if (file === null) {
    return;
  }

  // 2. Parse the diagrams of the file and find the diagrams that link it.
  const changes = { root: file.root, files: [file.absolute] };
  const shown = file.segments.join('/');
  const syntax = (await diagramSyntax.check(changes)).map(
    finding => `${shown}:${finding.line} ${finding.rule} ${finding.message}`,
  );

  const linking = (await linkedDiagrams.check(changes)).map(finding => {
    const document = relative(file.root, finding.file).split(sep).join('/');

    return `${document}:${finding.line} ${finding.rule}`;
  });

  const context = [
    ...(syntax.length > 0
      ? [
          'Mermaid (diagrams skill) cannot parse the last edit. Fix each line in your next edit:',
          ...syntax,
        ]
      : []),
    ...(linking.length > 0
      ? [
          `Diagrams (diagrams skill) link ${shown}. Check that each one still shows what the code does, and update it when it does not:`,
          ...linking,
        ]
      : []),
  ];

  // 3. Hand both lists to Claude, silence when both are empty.
  if (context.length > 0) {
    report(context);
  }
}
