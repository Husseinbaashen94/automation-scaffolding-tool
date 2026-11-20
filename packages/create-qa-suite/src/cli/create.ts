#!/usr/bin/env node
import { main } from './main.js';

process.exitCode = await main('create', process.argv.slice(2));
