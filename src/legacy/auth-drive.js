import { getAuthUrl, saveTokenFromCode } from './drive.js';

const codeArg = process.argv.find(a => a.startsWith('--code='));
if (codeArg) {
  const code = codeArg.slice('--code='.length);
  const path = await saveTokenFromCode(code);
  console.log(`Saved token to ${path}`);
} else {
  console.log('Open this URL, approve access, then run:');
  console.log('node src/cli.js auth:drive --code=PASTE_CODE_HERE');
  console.log('');
  console.log(getAuthUrl());
}
