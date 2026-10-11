#!/usr/bin/env node

/**
 * PreToolUse hook: blocks dangerous operations before they execute.
 * Called by Claude Code before any tool use.
 */

const SECRET_FILE_PATTERNS = [
  '.env',
  '.env.local',
  '.env.production',
  'secrets.json',
  '*.key',
  '*.pem',
  '**/credentials/**',
];

function matchesPattern(filePath, patterns) {
  return patterns.some((pattern) => {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(filePath);
  });
}

function main() {
  const stdin = process.stdin;
  let data = '';

  stdin.on('data', (chunk) => {
    data += chunk;
  });

  stdin.on('end', () => {
    try {
      const event = JSON.parse(data);
      const { tool, parameters } = event;

      // Block git push to main
      if (tool === 'Shell' && parameters.command) {
        const cmd = parameters.command.toLowerCase();
        if (
          cmd.includes('git push') &&
          (cmd.includes('origin main') ||
            cmd.includes('origin/main') ||
            cmd.match(/git\s+push\s+(?!.*origin\s+\S)/)) // bare 'git push' when on main
        ) {
          console.error(
            JSON.stringify({
              allowed: false,
              reason:
                '❌ Blocked: Direct push to main is not allowed. Create a feature branch instead.',
            })
          );
          process.exit(1);
        }
      }

      // Block editing secret files
      if (
        (tool === 'StrReplace' || tool === 'Write') &&
        parameters.path
      ) {
        const filePath = parameters.path;
        if (matchesPattern(filePath, SECRET_FILE_PATTERNS)) {
          console.error(
            JSON.stringify({
              allowed: false,
              reason: `❌ Blocked: Editing secret file "${filePath}" is not allowed. Use .env.example as template, never commit actual secrets.`,
            })
          );
          process.exit(1);
        }
      }

      // Allow by default
      console.log(JSON.stringify({ allowed: true }));
      process.exit(0);
    } catch (err) {
      console.error(
        JSON.stringify({
          allowed: false,
          reason: `Hook error: ${err.message}`,
        })
      );
      process.exit(1);
    }
  });
}

main();
