import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { handleRequest } from './ride-plan.mjs';

const host = '127.0.0.1';

export function startLocalServer(port = Number(process.env.PORT ?? 8787)) {
  return createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, `http://${host}:${incoming.socket.localPort}`);
      const response = await handleRequest(new Request(url, { method: incoming.method }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch {
      outgoing.writeHead(500, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ status: 'internal_error' }));
    }
  }).listen(port, host);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = startLocalServer();
  server.once('listening', () => console.log(`Bridge Day API listening at http://${host}:${server.address().port}`));
}
