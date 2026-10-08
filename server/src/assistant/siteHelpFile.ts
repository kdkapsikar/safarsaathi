import { readFileSync } from 'node:fs';
import { setHelpSource } from './siteHelp.js';

/** Server side: help topics come from docs/site-help.md. */
const HELP_FILE = new URL('../../../docs/site-help.md', import.meta.url);
setHelpSource(() => readFileSync(HELP_FILE, 'utf8'));
