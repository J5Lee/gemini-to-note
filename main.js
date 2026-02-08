// ==UserScript==
// @name          Gemini to Note (Notion & Obsidian Integrated)
// @namespace     http://tampermonkey.net/
// @version       4.0
// @description   Integrated transfer to Notion and Obsidian, perfect support for tables and formulas
// @author        Gemini Partner
// @match         https://gemini.google.com/*
// @grant         GM_xmlhttpRequest
// @connect       YOUR_NOTION_URL
// @connect       YOUR_OBSIDIAN_URL
// @require       https://unpkg.com/turndown/dist/turndown.js
// @require       https://unpkg.com/turndown-plugin-gfm/dist/turndown-plugin-gfm.js
// @run-at        document-idle
// ==/UserScript==

(function () {
    'use strict';

    // API Settings
    const NOTION_CONF = {
        URL: "YOUR_NOTION_URL",
        KEY: "YOUR_NOTION_KEY"
    };
    const OBSIDIAN_CONF = {
        URL: "YOUR_OBSIDIAN_URL",
        KEY: "YOUR_OBSIDIAN_KEY"
    };

    // Trusted Types Policy Setup
    if (window.trustedTypes && window.trustedTypes.createPolicy) {
        try {
            if (!window.trustedTypes.defaultPolicy) {
                window.trustedTypes.createPolicy('default', {
                    createHTML: (s) => s,
                    createScript: (s) => s,
                    createScriptURL: (s) => s
                });
            }
        } catch (e) { }
    }

    // Initialize Turndown service and set rules
    let turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', hr: '---' });
    if (typeof turndownPluginGfm !== 'undefined') turndownService.use(turndownPluginGfm.gfm);

    turndownService.escape = (s) => s;

    // Apply math and formatting rules
    turndownService.addRule('blockMath', {
        filter: (n) => n.nodeName === 'DIV' && n.classList.contains('math-block'),
        replacement: (c, n) => `\n\n$$\n${n.getAttribute('data-math')}\n$$\n\n`
    });
    turndownService.addRule('inlineMath', {
        filter: (n) => n.nodeName === 'SPAN' && n.classList.contains('math-inline'),
        replacement: (c, n) => `$${n.getAttribute('data-math')}$`
    });
    turndownService.addRule('heading4', { filter: 'h4', replacement: (c) => `\n\n### ${c}\n\n` });
    turndownService.addRule('horizontalRule', { filter: 'hr', replacement: () => '\n\n---\n\n' });

    function injectButtons() {
        const responseBlocks = document.querySelectorAll('message-content');

        responseBlocks.forEach(block => {
            if (block.querySelector('.kb-btn-wrapper')) return;

            // Create button container (Flexbox horizontal alignment)
            const wrapper = document.createElement('div');
            wrapper.className = 'kb-btn-wrapper';
            wrapper.style = 'display: flex; gap: 8px; margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee; align-items: center;';

            // Common button creation function
            const createBtn = (text, bgColor, className) => {
                const btn = document.createElement('button');
                btn.innerText = text;
                btn.className = className;
                btn.style = `padding: 6px 14px; cursor: pointer; background: ${bgColor}; color: #fff; border: none; border-radius: 6px; font-weight: bold; font-size: 11px; transition: opacity 0.2s;`;
                btn.onmouseover = () => btn.style.opacity = '0.8';
                btn.onmouseout = () => btn.style.opacity = '1';
                return btn;
            };

            const nBtn = createBtn('Send to Notion', '#000', 'send-to-notion-btn');
            const oBtn = createBtn('Send to Obsidian', '#483699', 'send-to-obsidian-btn');

            nBtn.onclick = (e) => handleTransfer(e, block, 'Notion', wrapper);
            oBtn.onclick = (e) => handleTransfer(e, block, 'Obsidian', wrapper);

            wrapper.appendChild(nBtn);
            wrapper.appendChild(oBtn);
            block.appendChild(wrapper);
        });
    }

    function handleTransfer(e, block, target, wrapper) {
        e.preventDefault();
        const title = window.prompt(`Enter ${target} title:`, "Gemini Response");
        if (!title) return;

        try {
            wrapper.style.display = 'none';
            const markdown = turndownService.turndown(block);
            wrapper.style.display = 'flex';

            const isObs = target === 'Obsidian';
            const fileName = encodeURIComponent(title.replace(/[\\/:*?"<>|]/g, "")) + ".md";

            GM_xmlhttpRequest({
                method: isObs ? "PUT" : "POST",
                url: isObs ? `${OBSIDIAN_CONF.URL}/${fileName}` : NOTION_CONF.URL,
                data: isObs ? markdown : JSON.stringify({ title, content: markdown }),
                headers: {
                    "Content-Type": isObs ? "text/markdown" : "application/json",
                    "Accept": "application/json",
                    [isObs ? "Authorization" : "X-API-Key"]: isObs ? `Bearer ${OBSIDIAN_CONF.KEY}` : NOTION_CONF.KEY
                },
                onload: (res) => {
                    if (res.status === 200 || res.status === 204) alert(`✅ ${target} Transfer Complete!`);
                    else alert(`❌ Transfer Failed (${res.status})\n`);
                },
                onerror: () => alert(`⚠️ ${target} Network Error occurred`)
            });
        } catch (err) {
            alert('An error occurred during conversion');
            console.error(err);
        }
    }

    setInterval(injectButtons, 2000);
})();