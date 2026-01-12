#!/usr/bin/env node

/**
 * Verifica se o comando está sendo executado com npm
 * Se sim, bloqueia a execução e força o uso de yarn
 */

if (process.env.npm_config_user_agent && process.env.npm_config_user_agent.startsWith('npm/')) {
  console.error('❌ Please use yarn instead of npm');
  process.exit(1);
}
