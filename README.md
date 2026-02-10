<p align="center">
  <img src="icon.png" width="200" height="200">
</p>

# Gemini to Note (Notion & Obsidian Integrated)
A Tampermonkey userscript that allows you to easily send Gemini (Google AI) responses directly to Notion or Obsidian. It is designed to handle tables, math formulas (LaTeX), and Markdown formatting, with a special focus on fixing common rendering issues.

### Motivation

Have you ever found yourself constantly copying and pasting responses from Gemini (Google AI) into your personal notes, only to be frustrated by the tedious process and broken formatting? This script was born out of that very frustration. Manually transferring information from the web to Notion or Obsidian, especially when dealing with rich content like tables or code blocks, is not only time-consuming but often results in a loss of valuable formatting. This project aims to streamline that workflow, ensuring your AI-generated insights are seamlessly integrated into your knowledge base.

## Features

- **One-Click Export**: Adds "Send to Notion" and "Send to Obsidian" buttons directly under Gemini responses.
- **Rich Formatting**: Preserves tables, bold/italic text, and lists.
- **Math Support**: Support for inline and block math formulas using LaTeX.
- **Customizable**: Set your own API endpoints and keys for Notion and Obsidian integrations.

> [!NOTE]
> **Disclaimer**: This tool was built to address specific formatting challenges I encountered, particularly with **math formulas** and **bold text**. While I have strived to solve these problems, please note that there may still be unresolved issues or edge cases.

## Installation

1. Install the **Tampermonkey** extension for your browser (Chrome, Firefox, Edge, etc.).
2. Click on the Tampermonkey icon and select "Create a new script".
3. Copy and paste the entire content of `main.js` from this repository into the editor.
4. Save the script (Ctrl+S or Cmd+S).

## Configuration

Before using the script, you need to configure your API keys and endpoints in the `main.js` file:

```javascript
// API Settings
const NOTION_CONF = {
    URL: "YOUR_NOTION_URL",                 // Replace with your Notion worker/proxy URL
    KEY: "YOUR_NOTION_KEY"                 // Replace with your Notion API key
};
const OBSIDIAN_CONF = {
    URL: "YOUR_OBSIDIAN_URL",               // Replace with your Obsidian Local REST API URL
    KEY: "YOUR_OBSIDIAN_KEY"                // Replace with your Obsidian Local REST API key
};
```

### Notion Server Setup

> [!IMPORTANT]
> To use the **Send to Notion** feature, you must run the included `server.py` Flask server. This server acts as a proxy between the Tampermonkey script and the Notion API, handling markdown-to-Notion block conversion.

#### 1. Install Dependencies

```bash
pip install flask flask-cors notion-client
```

#### 2. Configure `server.py`

Open `server.py` and replace the following placeholder values with your own:

| Variable | Description | How to Obtain |
|---|---|---|
| `NOTION_TOKEN` | Notion Internal Integration Token | [My Integrations](https://www.notion.so/my-integrations) |
| `PARENT_PAGE_ID` | ID of the parent page for new notes | Copy from the Notion page URL |
| `API_KEY` | Key to authenticate requests from the script | Generate with `python -c "import secrets; print(secrets.token_urlsafe(32))"` or set via `NOTION_API_KEY` env variable |

> [!NOTE]
> Make sure your Notion integration has access to the parent page. Go to the page in Notion → **⋯ (More)** → **Connections** → Add your integration.

#### 3. Run the Server

```bash
python server.py
```

The server runs on `http://0.0.0.0:5000` by default.
#### 4. Update `main.js`

Set `NOTION_CONF.URL` to your server's `/notion` endpoint and `NOTION_CONF.KEY` to the `API_KEY` you configured in `server.py`.

### Important Note on Chrome & HTTPS

> [!WARNING]
> Due to Chrome's security policies, you must use **HTTPS** links for the API endpoints. This usually requires purchasing a domain and obtaining an SSL certificate for your proxy/server. However, if you have a method to bypass this or use a service that provides HTTPS automatically, you can skip the manual SSL setup.

## Usage

![Usage Example](example.png)

1. Open [Gemini](https://gemini.google.com/).
2. Start a conversation or view an existing one.
3. You will see two buttons at the bottom of each Gemini response: **Send to Notion** and **Send to Obsidian**.
4. Click the desired button.
5. Enter a title for the note when prompted.
6. A success message will appear once the transfer is complete.

## Roadmap

- [ ] Migrate to a standalone **Chrome Extension** (no Tampermonkey dependency)

---

*This project was created with the help of **Gemini**.*

## License

MIT License
