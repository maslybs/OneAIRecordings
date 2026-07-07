import { loadConfig } from '../runtime/common.js';
import { syncCalendarJobs } from './google.js';

const result = await syncCalendarJobs(loadConfig());
console.log(JSON.stringify(result, null, 2));
