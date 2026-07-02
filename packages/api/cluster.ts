import cluster from 'node:cluster';
import os from 'node:os';
import { start } from './index.js';

const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
  console.log(`[cluster] Node ${process.version} — spawning ${numCPUs} workers`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`[cluster] worker ${worker.process.pid} exited (${signal ?? code}) — restarting`);
    cluster.fork();
  });
} else {
  // Each worker is a full Express server; Node's cluster module
  // makes all workers share the same PORT via the primary's socket.
  await start();
}
