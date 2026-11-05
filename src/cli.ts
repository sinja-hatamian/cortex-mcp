#!/usr/bin/env node
import {
  serveStdio,
  StdioServerTransport,
} from '@modelcontextprotocol/server/stdio';
import { createServer } from './server/create-server.js';

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
