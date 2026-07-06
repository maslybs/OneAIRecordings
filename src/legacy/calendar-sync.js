import { loadConfig } from './common.js';
import { syncCalendarJobs } from './calendar.js';

const result = await syncCalendarJobs(loadConfig());
console.log(JSON.stringify(result, null, 2));
