#!/usr/bin/env node

// Greets the name given on the command line, a demo change to try the pull-request skills on.

const [name] = process.argv.slice(2);

if (!name) {
  console.error('usage: greet.mts <name>');
  process.exit(1);
}

console.log(`Hello, ${name}.`);
