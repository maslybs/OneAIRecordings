import { getAuthUrl, saveTokenFromCode } from './drive.js';
import { parseCliArg } from '../runtime/common.js';

const code = parseCliArg('code');
if (code) {
  const path = await saveTokenFromCode(code);
  console.log(`Saved token to ${path}`);
} else {
  console.log('Open this URL, approve access, then run:');
  console.log('node src/cli.js auth:drive --code=PASTE_CODE_HERE');
  console.log('');
  console.log(getAuthUrl());
}
