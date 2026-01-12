#!/usr/bin/env node

/**
 * chat-export.js
 *
 * 🧠 Exporta conversas (ChatGPT, Claude, etc.) para Markdown limpo.
 * 🔧 Requisitos:
 *   - Node.js 18+
 *   - npm install puppeteer axios
 *   - O script instala Gemini CLI automaticamente se não houver.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import puppeteer from "puppeteer";

// ===============================================================
// 🔹 Função utilitária: garantir instalação do Gemini CLI
// ===============================================================
function ensureGeminiInstalled() {
  try {
    execSync(process.platform === "win32" ? "where gemini" : "command -v gemini");
    return true;
  } catch {
    console.warn("⚠️ Gemini CLI não encontrado. Instalando automaticamente...");
    try {
      execSync("npm install -g @google/gemini-cli", { stdio: "inherit", shell: true });
      console.log("✅ Gemini CLI instalado com sucesso!");
      return true;
    } catch (e) {
      console.error("❌ Falha ao instalar Gemini CLI:", e.message);
      return false;
    }
  }
}

// ===============================================================
// 🔹 Função principal
// ===============================================================
const chatUrl = process.argv[2];
if (!chatUrl) {
  console.error("❌ Uso: node chat-export.js <URL da conversa>");
  process.exit(1);
}

(async () => {
  console.log(`🌐 Coletando conversa: ${chatUrl}`);

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(chatUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector("body");

    // Extrai texto visível
    const rawText = await page.evaluate(() => {
      const blocks = Array.from(document.querySelectorAll("main, article, .conversation-turn, .message"));
      return blocks.map(b => b.innerText.trim()).filter(Boolean).join("\n\n---\n\n");
    });

    if (!rawText.trim()) throw new Error("Não foi possível extrair texto da página.");

    // Gera nome e salva versão bruta
    const title = chatUrl.split("/").pop().split("?")[0].slice(0, 40);
    const outputDir = path.resolve("./docs/chats");
    fs.mkdirSync(outputDir, { recursive: true });

    const filePath = path.join(outputDir, `${title}.md`);
    fs.writeFileSync(filePath, rawText);
    console.log(`✅ Conversa bruta salva em: ${filePath}`);

    // ===============================================================
    // 🔹 Limpeza e formatação com Gemini
    // ===============================================================
    if (!ensureGeminiInstalled()) {
      console.warn("⚠️ Não foi possível usar Gemini — mantendo apenas versão bruta.");
      return;
    }

    const cleanedPath = filePath.replace(/\.md$/, "-clean.md");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-run-"));

    try {
      console.log("🧹 Limpando e formatando com Gemini CLI...");

      // Cria diretório temporário isolado
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-run-"));

      // Rodar Gemini de forma não interativa e segura
      const prompt = "Limpe, organize e formate o texto abaixo em Markdown com seções claras de Usuário e Assistente, preservando blocos de código e listas.";
      const command = `cd "${tmpDir}" && gemini -p "${prompt}" < "${filePath}" > "${cleanedPath}"`;

      execSync(command, { stdio: "inherit", shell: true });

      console.log(`✨ Versão final salva em: ${cleanedPath}`);
    } catch (err) {
      console.warn("⚠️ Falha ao usar Gemini CLI — mantendo apenas versão bruta.");
    }


  } catch (err) {
    console.error("❌ Erro:", err.message);
  } finally {
    await browser.close();
  }
})();
