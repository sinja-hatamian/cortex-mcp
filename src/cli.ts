#!/usr/bin/env node
import {
  serveStdio,
  StdioServerTransport,
} from '@modelcontextprotocol/server/stdio';
import { createServer } from './server/create-server.js';

if (process.argv[2] === 'collect-test') {
  const { runTestCollector } = await import('./services/test-collector.js');
  runTestCollector(process.argv.slice(3));
} else {
  const transport = new StdioServerTransport(undefined, undefined, {
    maxBufferSize: 1024 * 1024,
  });
  let reportedTransportError = false;
  serveStdio(createServer, {
    transport,
    onerror() {
      if (reportedTransportError) return;
      reportedTransportError = true;
      process.stderr.write(
        'Cortex MCP encountered a stdio protocol or transport error.\n',
      );
    },
  });
}
