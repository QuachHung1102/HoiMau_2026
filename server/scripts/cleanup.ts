// Stops this project's own PostgreSQL clusters after a force-killed run left them behind.
// Run it only when no other server test run is in flight: every run shares the test cluster.
import { DEV, TEST, killCluster } from './cluster.ts';

let killed = 0;
for (const cluster of [TEST, DEV]) {
  for (const pid of await killCluster(cluster)) {
    killed++;
    console.log(`killed PID ${pid} (port ${cluster.port}, ${cluster.dataDir})`);
  }
}
if (killed === 0) {
  console.log('nothing running');
}
