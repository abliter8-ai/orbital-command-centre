#!/usr/bin/env node
import { loadCatalog } from "./catalog.js";
import { refreshCatalogIfStale } from "./refresh.js";
import { createOccServer } from "./server.js";

const catalog = loadCatalog();
refreshCatalogIfStale(catalog);
const server = createOccServer(undefined, { catalog });
await server.run();
