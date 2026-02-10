from flask import Flask, request, jsonify
from flask_cors import CORS
import re
import os
import secrets
from datetime import datetime, timedelta
from functools import wraps
from collections import defaultdict
from notion_client import Client

app = Flask(__name__)

# CORS - allow only gemini.google.com
CORS(app, origins=["https://gemini.google.com"])

# =====================================================================
# CONFIGURATION — You MUST replace the values below with your own.
# =====================================================================

# [REQUIRED] Your Notion Internal Integration Token.
# How to get one: https://www.notion.so/my-integrations
NOTION_TOKEN = "YOUR_NOTION_INTEGRATION_TOKEN"

# [REQUIRED] The ID of the Notion parent page where new pages will be created.
# You can find this in the page URL: https://www.notion.so/Your-Page-<PAGE_ID>
PARENT_PAGE_ID = "YOUR_NOTION_PARENT_PAGE_ID"

notion = Client(auth=NOTION_TOKEN)

# [REQUIRED] API key used by the Tampermonkey script to authenticate requests.
# Set via the NOTION_API_KEY environment variable, or replace the default value below.
# Generate a secure key with: python -c "import secrets; print(secrets.token_urlsafe(32))"
API_KEY = os.environ.get('NOTION_API_KEY', 'YOUR_API_KEY_HERE')

# Rate limiting settings
RATE_LIMIT_REQUESTS = 30  # Max requests per window
RATE_LIMIT_WINDOW = 60    # Window size in seconds
request_counts = defaultdict(list)


def get_client_ip():
    """Get the real client IP address (works behind proxies)."""
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    return request.remote_addr


def check_rate_limit(ip):
    """Check if the client has exceeded the rate limit."""
    now = datetime.now()
    window_start = now - timedelta(seconds=RATE_LIMIT_WINDOW)

    # Remove expired entries
    request_counts[ip] = [t for t in request_counts[ip] if t > window_start]

    if len(request_counts[ip]) >= RATE_LIMIT_REQUESTS:
        return False

    request_counts[ip].append(now)
    return True


def require_api_key(f):
    """Decorator that enforces API key authentication and rate limiting."""
    @wraps(f)
    def decorated(*args, **kwargs):
        client_ip = get_client_ip()

        # Rate limiting check
        if not check_rate_limit(client_ip):
            print(f"[SECURITY] Rate limit exceeded: {client_ip}")
            return jsonify({"error": "Too many requests"}), 429

        # API key validation
        api_key = request.headers.get('X-API-Key')
        if not api_key or api_key != API_KEY:
            print(f"[SECURITY] Unauthorized access attempt from {client_ip}")
            return jsonify({"error": "Unauthorized"}), 401

        # Origin validation (additional layer on top of CORS)
        origin = request.headers.get('Origin', '')
        if origin and 'gemini.google.com' not in origin:
            print(f"[SECURITY] Invalid origin: {origin} from {client_ip}")
            return jsonify({"error": "Forbidden"}), 403

        return f(*args, **kwargs)
    return decorated


def split_text(text, limit=2000):
    return [text[i : i + limit] for i in range(0, len(text), limit)]


def text_to_rich_text(text, inherited_annotations=None):
    """
    Convert markdown inline syntax to Notion rich_text array.
    inherited_annotations: styles inherited from a parent element (e.g. text inside bold)
    """
    if inherited_annotations is None:
        inherited_annotations = {}

    rich_text_array = []

    # Combined regex pattern for all inline markdown elements
    # Groups: (1)equation, (2)bold**, (3)bold__, (4)italic*, (5)italic_, (6)code, (7)strikethrough, (8)link_text, (9)link_url
    combined_pattern = r'(?<!\$)\$(?!\$)([^$]+?)\$(?!\$)|\*\*(.+?)\*\*|__(.+?)__|(?<!\*)\*(?!\*)([^*]+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)([^_]+?)(?<!_)_(?!_)|`([^`]+)`|~~(.+?)~~|\[([^\]]+)\]\(([^)]+)\)'

    last_end = 0

    for match in re.finditer(combined_pattern, text, re.DOTALL):
        # Plain text before this match
        if match.start() > last_end:
            plain_text = text[last_end:match.start()]
            if plain_text:
                for chunk in split_text(plain_text):
                    item = {"type": "text", "text": {"content": chunk}}
                    if inherited_annotations:
                        item["annotations"] = inherited_annotations.copy()
                    rich_text_array.append(item)

        groups = match.groups()

        # Inline equation ($...$)
        if groups[0] is not None:
            content = groups[0]
            for chunk in split_text(content):
                rich_text_array.append({"type": "equation", "equation": {"expression": chunk}})

        # Bold (**...** or __...__) — recursively parse inner content
        elif groups[1] is not None or groups[2] is not None:
            content = groups[1] or groups[2]
            new_annotations = inherited_annotations.copy()
            new_annotations["bold"] = True
            inner_rich_text = text_to_rich_text(content, new_annotations)
            rich_text_array.extend(inner_rich_text)

        # Italic (*...* or _..._)
        elif groups[3] is not None or groups[4] is not None:
            content = groups[3] or groups[4]
            new_annotations = inherited_annotations.copy()
            new_annotations["italic"] = True
            inner_rich_text = text_to_rich_text(content, new_annotations)
            rich_text_array.extend(inner_rich_text)

        # Inline code (`...`)
        elif groups[5] is not None:
            content = groups[5]
            for chunk in split_text(content):
                annotations = inherited_annotations.copy()
                annotations["code"] = True
                rich_text_array.append({"type": "text", "text": {"content": chunk}, "annotations": annotations})

        # Strikethrough (~~...~~)
        elif groups[6] is not None:
            content = groups[6]
            new_annotations = inherited_annotations.copy()
            new_annotations["strikethrough"] = True
            inner_rich_text = text_to_rich_text(content, new_annotations)
            rich_text_array.extend(inner_rich_text)

        # Link ([text](url))
        elif groups[7] is not None and groups[8] is not None:
            link_text = groups[7]
            link_url = groups[8]
            for chunk in split_text(link_text):
                item = {"type": "text", "text": {"content": chunk, "link": {"url": link_url}}}
                if inherited_annotations:
                    item["annotations"] = inherited_annotations.copy()
                rich_text_array.append(item)

        last_end = match.end()

    # Remaining text after the last match
    if last_end < len(text):
        remaining = text[last_end:]
        if remaining:
            for chunk in split_text(remaining):
                item = {"type": "text", "text": {"content": chunk}}
                if inherited_annotations:
                    item["annotations"] = inherited_annotations.copy()
                rich_text_array.append(item)

    # Prevent empty array (Notion API requires at least one element)
    if not rich_text_array:
        item = {"type": "text", "text": {"content": text if text else ""}}
        if inherited_annotations:
            item["annotations"] = inherited_annotations.copy()
        rich_text_array.append(item)

    return rich_text_array


def parse_markdown_to_blocks(text):
    # Remove injected button text if present
    text = re.sub(r'\n*Send to Notion\s*$', '', text)

    blocks = []
    lines = text.split('\n')

    is_code_block = False
    is_equation_block = False
    buffer = []
    current_lang = "plain text"

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped_line = line.strip()

        # 1. Block equation ($$)
        if stripped_line.startswith("$$") and not is_code_block:
            if not is_equation_block:
                is_equation_block = True
                buffer = []
                if stripped_line.endswith("$$") and len(stripped_line) > 4:
                    formula = stripped_line[2:-2].strip()
                    for chunk in split_text(formula):
                        blocks.append({"object": "block", "type": "equation", "equation": {"expression": chunk}})
                    is_equation_block = False
                elif len(stripped_line) > 2:
                    buffer.append(stripped_line[2:])
                i += 1
                continue
            else:
                if stripped_line.endswith("$$") and len(stripped_line) > 2:
                    buffer.append(stripped_line[:-2])
                full_eq = '\n'.join(buffer)
                for chunk in split_text(full_eq):
                    blocks.append({"object": "block", "type": "equation", "equation": {"expression": chunk}})
                is_equation_block = False
                i += 1
                continue

        if is_equation_block:
            if stripped_line.endswith("$$"):
                buffer.append(stripped_line[:-2])
                full_eq = '\n'.join(buffer)
                for chunk in split_text(full_eq):
                    blocks.append({"object": "block", "type": "equation", "equation": {"expression": chunk}})
                is_equation_block = False
            else:
                buffer.append(line)
            i += 1
            continue

        # 2. Code block (```)
        if stripped_line.startswith('```'):
            if not is_code_block:
                is_code_block = True
                current_lang = stripped_line[3:].strip() or "plain text"
                lang_map = {
                    "js": "javascript", "ts": "typescript", "py": "python",
                    "rb": "ruby", "yml": "yaml", "sh": "shell", "bash": "shell", "zsh": "shell",
                }
                current_lang = lang_map.get(current_lang.lower(), current_lang)
                buffer = []
            else:
                full_code = '\n'.join(buffer)
                blocks.append({
                    "object": "block", "type": "code",
                    "code": {
                        "rich_text": [{"type": "text", "text": {"content": chunk}} for chunk in split_text(full_code)],
                        "language": current_lang
                    }
                })
                is_code_block = False
            i += 1
            continue

        if is_code_block:
            buffer.append(line)
            i += 1
            continue

        # 3. Blockquote (>) — collect consecutive lines into a callout block
        if stripped_line.startswith('> ') or stripped_line == '>':
            quote_lines = []
            while i < len(lines):
                current = lines[i].strip()
                if current.startswith('> '):
                    quote_lines.append(current[2:])
                    i += 1
                elif current == '>':
                    quote_lines.append('')
                    i += 1
                else:
                    break

            # Remove empty lines
            quote_lines = [l for l in quote_lines if l.strip()]

            if quote_lines:
                # Parse inner content and create children blocks
                inner_content = '\n'.join(quote_lines)
                inner_blocks = parse_markdown_to_blocks(inner_content)

                if inner_blocks:
                    # Use Notion callout block (supports children)
                    blocks.append({
                        "object": "block",
                        "type": "callout",
                        "callout": {
                            "rich_text": [],
                            "icon": {"type": "emoji", "emoji": "💡"},
                            "children": inner_blocks[:100]  # Notion limit: 100 children per block
                        }
                    })
            continue

        # 4. Headings (h4 → h3 conversion, Notion only supports up to h3)
        if line.startswith('#### '):
            blocks.append({"object": "block", "type": "heading_3", "heading_3": {"rich_text": text_to_rich_text(line[5:])}})
            i += 1
            continue
        elif line.startswith('### '):
            blocks.append({"object": "block", "type": "heading_3", "heading_3": {"rich_text": text_to_rich_text(line[4:])}})
            i += 1
            continue
        elif line.startswith('## '):
            blocks.append({"object": "block", "type": "heading_2", "heading_2": {"rich_text": text_to_rich_text(line[3:])}})
            i += 1
            continue
        elif line.startswith('# '):
            blocks.append({"object": "block", "type": "heading_1", "heading_1": {"rich_text": text_to_rich_text(line[2:])}})
            i += 1
            continue

        # 5. Checkbox / To-do list
        checkbox_match = re.match(r'^[-*]\s*\[([ xX])\]\s*(.+)$', stripped_line)
        if checkbox_match:
            checked = checkbox_match.group(1).lower() == 'x'
            content = checkbox_match.group(2)
            blocks.append({
                "object": "block", "type": "to_do",
                "to_do": {"rich_text": text_to_rich_text(content), "checked": checked}
            })
            i += 1
            continue

        # 6. Numbered list
        numbered_match = re.match(r'^(\d+)\.\s+(.+)$', stripped_line)
        if numbered_match:
            content = numbered_match.group(2)
            blocks.append({
                "object": "block", "type": "numbered_list_item",
                "numbered_list_item": {"rich_text": text_to_rich_text(content)}
            })
            i += 1
            continue

        # 7. Bulleted list
        if line.startswith('- ') or line.startswith('* '):
            blocks.append({"object": "block", "type": "bulleted_list_item", "bulleted_list_item": {"rich_text": text_to_rich_text(line[2:])}})
            i += 1
            continue

        # 8. Horizontal rule
        if re.match(r'^[-*_]{3,}$', stripped_line):
            blocks.append({"object": "block", "type": "divider", "divider": {}})
            i += 1
            continue

        # 9. Regular paragraph
        if stripped_line:
            blocks.append({"object": "block", "type": "paragraph", "paragraph": {"rich_text": text_to_rich_text(line)}})

        i += 1

    return blocks


@app.route('/notion', methods=['POST'])
@require_api_key
def create_notion_page():
    client_ip = get_client_ip()
    data = request.json
    title = data.get('title', 'Gemini Response')
    content = data.get('content', '')

    try:
        blocks = parse_markdown_to_blocks(content)

        page = notion.pages.create(
            parent={"page_id": PARENT_PAGE_ID},
            properties={"title": {"title": [{"text": {"content": title}}]}},
            children=blocks[:100]
        )

        if len(blocks) > 100:
            page_id = page["id"]
            for i in range(100, len(blocks), 100):
                notion.blocks.children.append(
                    block_id=page_id,
                    children=blocks[i:i+100]
                )

        print(f"[SUCCESS] Page created: '{title}' from {client_ip}")
        return jsonify({"status": "success"}), 200
    except Exception as e:
        print(f"[ERROR] Server Error from {client_ip}: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/key')
def check_ip():
    # Read client IP from X-Real-IP header (set by Nginx)
    client_ip = request.headers.get('X-Real-IP', request.remote_addr)
    # X-Forwarded-For contains the full proxy chain if multiple proxies are used
    forwarded_ip = request.headers.get('X-Forwarded-For', client_ip)

    print(f"Actual Client IP: {client_ip}")
    return "IP Checked"


# Handle unknown routes
@app.errorhandler(404)
def not_found(e):
    client_ip = get_client_ip()
    print(f"[SECURITY] 404 access attempt: {request.path} from {client_ip}")
    return jsonify({"error": "Not found"}), 404


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy"}), 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)