# Schola Python Client

A lightweight, programmatic Python client for the **Schola** portal of Colegio (and other schools running on Schola). 
It reverse-engineers internal API endpoints to read messages from the "Mensajería" (inbox) section **without browser automation**.

## Features

- **Programmatic HTTP Authentication**: Bypasses the frontend using direct POST request to `api/login/Ingresar`.
- **Session Auto-Refresh & Auto Re-Login**: Automatically handles JWT token expiration (`401` / `403` responses) using the token refresh endpoint `api/login/refresh` and falls back to full re-login on failure.
- **Message List Retrieval**: Fetches messages from any folder with pagination (25 items per segment) and optional filtering (e.g. unread-only).
- **Message Detail Retrieval**: Retrieves full message bodies (including HTML content, recipient list, and reading receipts).
- **Pydantic Data Models**: All API responses are validated and typed using Pydantic.

## Requirements

- Python 3.10+
- Dependencies: `requests`, `pydantic`, `python-dotenv`

## Installation

1. Create and activate a Python virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Configuration

Create a `.env` file in the root directory to store your credentials (do not commit this file to version control):

```env
SIEWEB_SCHOOL=santarosadelima
SIEWEB_USER=your_username
SIEWEB_PASS=your_password
```

## Quick Start

You can verify the integration by running the included functional test script:

```bash
python3 test_sieweb.py
```

This will authenticate, display the last 20 messages from the Inbox, apply keyword filtering, and print the plaintext body of one of the messages.

## Programmatic Usage

```python
from sieweb_client import SieWebClient

# Initialize the client (loads credentials)
client = SieWebClient(school_name="santarosadelima")

# Login
if client.login(username="f20240005", password="your_password"):
    print("Logged in!")

    # 1. Fetch inbox messages (Recibidos)
    messages = client.get_mensajes(limit=10, folder_id=1, only_unread=False)
    for msg in messages:
        print(f"[{msg.id_mensaje}] {msg.emisor_nombre}: {msg.asunto}")

    # 2. Get details for a specific message
    detail = client.get_mensaje_detalle(message_id=1068401, folder_id=1)
    if detail:
        print("Body:", detail.contenido_html)
        print("Recipients:")
        for r in detail.destinatarios:
            print(f" - {r.usuario_nombre} (Read: {r.leido})")

    # 3. Mark message as read
    client.marcar_leido(message_id=1068401, read=True)
```

## Folder IDs Reference
- `1`: Recibidos (Inbox)
- `2`: Enviados (Sent)
- `3`: Papelera (Trash)
- `4`: Archivados (Archived)

## FastAPI Web Server

A secured FastAPI wrapper is included in `app.py`. This web application exposes the client functionalities so your bot **Hermes** can query messages programmatically.

### Running Locally

1. Set the API Key and credentials in your `.env` file:
   ```env
   HERMES_API_KEY=your_secure_api_key_for_bot
   SIEWEB_SCHOOL=sancolegio
   SIEWEB_USER=your_username
   SIEWEB_PASS=your_password
   ```

2. Start the server using Uvicorn:
   ```bash
   uvicorn app:app --reload
   ```

3. Open your browser at `http://127.0.0.1:8000/docs` to see the Swagger interactive documentation.

### Deploying to Render (render.com)

1. Create a new **Web Service** on Render and connect your GitHub repository.
2. Select **Python** as the runtime.
3. Configure the following build settings:
   * **Build Command**: `pip install -r requirements.txt`
   * **Start Command**: `uvicorn app:app --host 0.0.0.0 --port $PORT`
4. Under **Environment Variables**, add:
   * `SIEWEB_SCHOOL`: `sancolegio` (or your school)
   * `SIEWEB_USER`: `your_school_username`
   * `SIEWEB_PASS`: `your_school_password`
   * `HERMES_API_KEY`: `a_very_long_secure_token_for_hermes`
5. Click **Deploy Web Service**.

### Integrating with Hermes Bot

Your bot **Hermes** can fetch messages by calling the API using the configured `HERMES_API_KEY` in the `X-API-Key` header:

```python
import requests

api_url = "https://your-app.onrender.com/mensajes"
headers = {
    "X-API-Key": "a_very_long_secure_token_for_hermes"
}

response = requests.get(api_url, headers=headers)
if response.status_code == 200:
    messages = response.json()
    for msg in messages:
        print(f"Nuevo mensaje de {msg['EMISORNOM']}: {msg['ASUNTO']}")
```

