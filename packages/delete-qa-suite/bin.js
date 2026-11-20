#!/usr/bin/env node
import { main } from 'create-qa-suite/cli';

process.exitCode = await main('delete', process.argv.slice(2));
