#!/usr/bin/env node
import { createOccServer } from "./server.js";

const server = createOccServer();
await server.run();
