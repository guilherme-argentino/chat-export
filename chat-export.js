#!/usr/bin/env node

/**
 * chat-export.js
 *
 * 📤 Exporta conversas do ChatGPT para Markdown estruturado.
 *
 * 📖 Uso:
 *   yarn run export https://chatgpt.com/share/<ID>
 */

import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";

const chatUrl = process.argv[2];
if (!chatUrl) {
  console.error("❌ Uso: yarn run export <URL da conversa>");
  process.exit(1);
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
}

(async () => {
  console.log(`🌐 Acessando: ${chatUrl}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  try {
    page.setDefaultTimeout(90000);
    page.setDefaultNavigationTimeout(90000);

    await page.goto(chatUrl, { waitUntil: "networkidle2" });
    console.log("⏳ Aguardando carregamento...");
    await page.waitForSelector("main", { timeout: 30000 });

    // Scroll agressivo até fim
    console.log("📜 Scrollando para carregar todo conteúdo...");
    await page.evaluate(() => {
      return new Promise((resolve) => {
        let totalHeight = 0;
        const distance = window.innerHeight;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight - window.innerHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 400);
      });
    });

    // Aguarda final do carregamento
    await new Promise(r => setTimeout(r, 2000));

    console.log("✓ Scroll completo");

    // Extrai dados de forma agressiva
    const pageData = await page.evaluate(() => {
      let title = document.querySelector("title")?.textContent || "Conversa";
      title = title.replace(/\s*[|-]\s*ChatGPT$/gi, "").replace(/ChatGPT\s*/gi, "").trim() || "Conversa";

      const now = new Date().toLocaleString("pt-BR");
      const main = document.querySelector("main");
      if (!main) return { title, createdDate: now, updatedDate: now, url: window.location.href, turns: [] };

      const turns = [];
      const seen = new Set();

      // Extrai TODOS os elementos com texto significativo
      const allDivs = main.querySelectorAll("div");

      for (const div of allDivs) {
        let text = div.innerText?.trim();
        if (!text || text.length < 15 || seen.has(text)) continue;

        // Ignora containers com muitos filhos
        if (div.children.length > 40) continue;

        // Ignora UI
        if (text.match(/^(Attach|Search|Create|Voice|Download|Read|Report|This is|ChatGPT can|Cookie)/i)) continue;

        seen.add(text);
        turns.push({ 
          role: text.length > 400 ? "assistant" : "unknown", 
          content: text 
        });
      }

      // Se não pegou nada, tenta articles e paragrafos
      if (turns.length === 0) {
        const others = main.querySelectorAll("article, p, [role='article']");
        for (const el of others) {
          let text = el.innerText?.trim();
          if (text && text.length > 20 && !seen.has(text)) {
            seen.add(text);
            turns.push({ role: "unknown", content: text });
          }
        }
      }

      return {
        title,
        createdDate: now,
        updatedDate: now,
        url: window.location.href,
        turns,
      };
    });

    console.log(`📄 Título: "${pageData.title}"`);
    console.log(`💬 Encontrados ${pageData.turns.length} blocos`);

    if (pageData.turns.length === 0) {
      throw new Error("Não foi possível extrair conteúdo da conversa");
    }

    // Formata Markdown
    let markdown = `# ${pageData.title}\n\n`;
    markdown += `**Created:** ${pageData.createdDate}  \n`;
    markdown += `**Updated:** ${pageData.updatedDate}  \n`;
    markdown += `**Exported:** ${new Date().toLocaleString("pt-BR")}  \n`;
    markdown += `**Link:** [${pageData.url}](${pageData.url})  \n\n`;

    let promptNumber = 0;
    let lastWasPrompt = false;

    for (const turn of pageData.turns) {
      const content = turn.content.trim();
      if (!content) continue;

      let isPrompt = turn.role === "user" ? true : turn.role === "assistant" ? false : !lastWasPrompt;

      if (isPrompt) {
        promptNumber++;
        markdown += `## Prompt ${promptNumber}:\n${content}\n\n`;
        lastWasPrompt = true;
      } else {
        markdown += `## Response ${promptNumber}:\n${content}\n\n`;
        lastWasPrompt = false;
      }
    }

    // Salva
    const outputDir = path.resolve("./docs/chats");
    fs.mkdirSync(outputDir, { recursive: true });
    const filename = sanitizeFilename(pageData.title);
    const filePath = path.join(outputDir, `${filename}.md`);

    fs.writeFileSync(filePath, markdown, "utf-8");

    console.log(`\n✅ Conversa exportada com sucesso!`);
    console.log(`📁 Arquivo: ${filePath}`);
    console.log(`📊 ${(markdown.length / 1024).toFixed(1)}KB, ${pageData.turns.length} blocos`);

  } catch (err) {
    console.error(`\n❌ Erro:`);
    console.error(`   ${err.message}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
