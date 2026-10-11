#!/usr/bin/env node

/**
 * Stop hook: runs quality checks when Claude Code session ends.
 * Called by Claude Code on session stop (user ends session or timeout).
 */

const { execSync } = require('child_process');
const fs = require('fs');

function run(cmd, description) {
  console.log(`\n🔍 ${description}...`);
  try {
    execSync(cmd, { stdio: 'inherit', encoding: 'utf-8' });
    console.log(`✅ ${description} passed`);
    return true;
  } catch (err) {
    console.error(`❌ ${description} failed`);
    return false;
  }
}

function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 Running quality checks...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const results = {
    lint: false,
    typecheck: false,
    test: false,
  };

  // Check if node_modules exists (dependencies installed)
  if (!fs.existsSync('node_modules')) {
    console.log('⚠️  Dependencies not installed. Run `npm install` first.');
    process.exit(1);
  }

  // Run checks
  results.lint = run('npm run lint', 'Lint');
  results.typecheck = run('npx tsc --noEmit', 'Type check');
  results.test = run('npm test', 'Tests');

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Quality Check Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`Lint:       ${results.lint ? '✅ Passed' : '❌ Failed'}`);
  console.log(`Type check: ${results.typecheck ? '✅ Passed' : '❌ Failed'}`);
  console.log(`Tests:      ${results.test ? '✅ Passed' : '❌ Failed'}`);

  const allPassed = results.lint && results.typecheck && results.test;

  if (allPassed) {
    console.log('\n✅ All checks passed! Ready to commit.\n');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some checks failed. Fix issues before committing.\n');
    process.exit(1);
  }
}

main();
