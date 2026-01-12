#!/usr/bin/env node

/**
 * chat-export.js
 *
 * 📤 Exporta conversas do ChatGPT para Markdown estruturado.
 *
 * 📖 Uso:
 *   yarn run export https://chatgpt.com/share/<ID>
 *   yarn run export https://chatgpt.com/c/<ID>
 *
 * 🔧 Requisitos:
 *   - Node.js 18+
 *   - Dependências: puppeteer, jsdom, turndown
 */

import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";

// ===============================================================
// 🔹 Validação de entrada
// ===============================================================
const chatUrl = process.argv[2];
if (!chatUrl) {
  console.error("❌ Uso: yarn run export <URL da conversa>");
  console.error("   Exemplo: yarn run export https://chatgpt.com/share/6964fb43-8e94-8010-8134-2214cdc4035f");
  process.exit(1);
}

// ===============================================================
// 🔹 Funções auxiliares
// ===============================================================

/**
 * Sanitiza nome de arquivo
 */
function sanitizeFilename(name) {
  return name
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

// ===============================================================
// 🔹 Função principal de extração
// ===============================================================
(async () => {
  console.log(`🌐 Acessando: ${chatUrl}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  try {
    // Define timeout e viewport
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);
    await page.setViewport({ width: 1280, height: 720 });

    // Acessa a URL
    await page.goto(chatUrl, { waitUntil: "networkidle2" });

    console.log("⏳ Aguardando carregamento completo...");
    await page.waitForSelector("body", { timeout: 30000 });

    // Extrai dados da página
    const pageData = await page.evaluate(() => {
      // Tenta extrair título do elemento title da página
      let title = document.querySelector("title")?.textContent || "Conversa";

      // Remove sufixos comuns
      title = title
        .replace(/\s*[|-]\s*ChatGPT$/gi, "")
        .replace(/\s*[|-]\s*OpenAI$/gi, "")
        .replace(/ChatGPT\s*/gi, "")
        .trim() || "Conversa";

      // Se ficar vazio ou muito genérico, usa um padrão
      if (!title || title === "Conversa") {
        // Tenta extrair do primeiro prompt ou padrão
        title = "Conversa" + new Date().getTime().toString().slice(-6);
      }

      // Tenta extrair data da página (pode estar em atributos ou texto)
      const pageText = document.body.innerText;
      let createdDate = null;
      let updatedDate = null;

      // Procura por padrões de data (formato comum: "1/11/2026 17:43:43")
      const dateMatch = pageText.match(/\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}/);
      if (dateMatch) {
        createdDate = dateMatch[0];
        updatedDate = dateMatch[0];
      }

      // Se não encontrou, usa valores padrão
      const now = new Date();
      if (!createdDate) {
        createdDate = now.toLocaleString("pt-BR");
        updatedDate = createdDate;
      }

      // Extrai turnos da conversa - estratégia melhorada
      const turns = [];
      const seenContent = new Set(); // Para evitar duplicatas

      // Procura pelos elementos de mensagem do ChatGPT
      // O ChatGPT estrutura as mensagens em divs dentro de main
      const main = document.querySelector("main");
      if (main) {
        // Procura por elementos que contêm as mensagens
        // Geralmente têm grupos de 2 (user e assistant) dentro de um container
        const messageGroups = main.querySelectorAll("[data-testid*='message'], .message-group, .space-y");

        // Se não encontrou com data-testid, tenta uma abordagem diferente
        let messageElements = Array.from(messageGroups);
        if (messageElements.length === 0) {
          // Procura por elementos com conteúdo significativo dentro de main
          messageElements = Array.from(main.querySelectorAll("div")).filter((el) => {
            const text = el.innerText?.trim();
            const children = el.children.length;
            // Elemento com texto, mas não é um container gigante
            return text && text.length > 20 && text.length < 5000 && children < 15;
          });
        }

        for (const el of messageElements) {
          const text = el.innerText?.trim();
          if (!text || seenContent.has(text) || text.length < 10) continue;

          // Skip elementos que parecem ser UI (cabeçalhos, botões, etc)
          if (
            text === "This is a copy of a conversation between ChatGPT & Anonymous." ||
            text === "Report conversation" ||
            text.includes("Attach") ||
            text.includes("Search") ||
            text.includes("Create image")
          ) {
            continue;
          }

          // Heurística para detectar user vs assistant
          let role = "unknown";
          const html = el.innerHTML || "";

          // Procura por classes ou atributos específicos
          if (
            html.includes('data-testid="user-message"') ||
            html.includes('data-testid=\'user-message\'') ||
            html.includes("from-gray") ||
            el.className.includes("user") ||
            el.className.match(/\byou\b/i)
          ) {
            role = "user";
          } else if (
            html.includes('data-testid="assistant-message"') ||
            html.includes('data-testid=\'assistant-message\'') ||
            html.includes("from-[#0D8ABC]") ||
            html.includes("bg-blue") ||
            el.className.includes("assistant") ||
            el.className.match(/\b(gpt|assistant|bot)\b/i)
          ) {
            role = "assistant";
          } else {
            // Fallback: heurística baseada em padrões de texto
            // Se tem colon no começo ou é muito longo sem estrutura, é provavelmente assistente
            if (text.startsWith("You:") || text.startsWith("You said:")) {
              role = "user";
            } else if (text.startsWith("ChatGPT:") || text.startsWith("ChatGPT said:") || text.length > 500) {
              role = "assistant";
            } else {
              // Alterna baseado no último role adicionado
              const lastTurn = turns[turns.length - 1];
              role = lastTurn?.role === "user" ? "assistant" : "user";
            }
          }

          // Adiciona se ainda não foi visto
          seenContent.add(text);
          turns.push({
            role,
            content: text,
          });
        }
      }

      return {
        title,
        createdDate,
        updatedDate,
        url: window.location.href,
        turns,
      };
    });

    console.log(`📄 Título: "${pageData.title}"`);
    console.log(`💬 Encontrados ${pageData.turns.length} turnos`);

    if (pageData.turns.length === 0) {
      throw new Error("Não foi possível extrair nenhuma mensagem da conversa.");
    }

    // ===============================================================
    // 🔹 Processamento e formatação
    // ===============================================================
    let markdown = `# ${pageData.title}\n\n`;

    // Metadados
    markdown += `**Created:** ${pageData.createdDate}  \n`;
    markdown += `**Updated:** ${pageData.updatedDate}  \n`;
    markdown += `**Exported:** ${new Date().toLocaleString("pt-BR")}  \n`;
    markdown += `**Link:** [${pageData.url}](${pageData.url})  \n\n`;

    // Turnos
    let promptCount = 0;
    let currentSection = null;

    for (const turn of pageData.turns) {
      const content = turn.content.trim();
      if (!content) continue;

      // Heurística para detectar padrão "You said:" / "ChatGPT said:"
      if (content.includes("You said:")) {
        promptCount++;
        currentSection = "prompt";
        const cleanContent = content.replace("You said:", "").trim();
        markdown += `## Prompt ${promptCount}:\n${cleanContent}\n\n`;
      } else if (
        content.includes("ChatGPT said:") ||
        content.includes("Assistant:") ||
        turn.role === "assistant"
      ) {
        const cleanContent = content
          .replace("ChatGPT said:", "")
          .replace("Assistant:", "")
          .trim();
        markdown += `## Response ${promptCount}:\n${cleanContent}\n\n`;
      } else if (turn.role === "user") {
        promptCount++;
        markdown += `## Prompt ${promptCount}:\n${content}\n\n`;
      } else if (turn.role === "assistant") {
        markdown += `## Response ${promptCount}:\n${content}\n\n`;
      } else {
        // Fallback: alterna entre prompt e response
        if (!currentSection || currentSection === "response") {
          promptCount++;
          currentSection = "prompt";
          markdown += `## Prompt ${promptCount}:\n${content}\n\n`;
        } else {
          currentSection = "response";
          markdown += `## Response ${promptCount}:\n${content}\n\n`;
        }
      }
    }

    // ===============================================================
    // 🔹 Salva arquivo
    // ===============================================================
    const outputDir = path.resolve("./docs/chats");
    fs.mkdirSync(outputDir, { recursive: true });

    const filename = sanitizeFilename(pageData.title);
    const filePath = path.join(outputDir, `${filename}.md`);

    fs.writeFileSync(filePath, markdown, "utf-8");

    console.log(`\n✅ Conversa exportada com sucesso!`);
    console.log(`📁 Arquivo: ${filePath}`);
    console.log(`📊 Tamanho: ${markdown.length} caracteres, ${pageData.turns.length} turnos`);

  } catch (err) {
    console.error(`\n❌ Erro ao exportar conversa:`);
    console.error(`   ${err.message}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
