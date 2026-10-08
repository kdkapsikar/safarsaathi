// better-sqlite3 is a native module built for one Node version. If this machine
// switches Node (nvm, Homebrew, an IDE's bundled Node), rebuild it before starting.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../server/package.json', import.meta.url));

function loads() {
  try {
    const Database = require('better-sqlite3');
    new Database(':memory:').close();
    return true;
  } catch (err) {
    if (err?.code === 'ERR_DLOPEN_FAILED' || /NODE_MODULE_VERSION/.test(String(err?.message))) {
      return false;
    }
    throw err;
  }
}

if (!loads()) {
  console.log(`[ensure-native] Rebuilding better-sqlite3 for Node ${process.version}…`);
  execSync('npm rebuild better-sqlite3', { stdio: 'inherit' });
  if (!loads()) {
    console.error('[ensure-native] better-sqlite3 still fails to load. Try: npm ci');
    process.exit(1);
  }
}
