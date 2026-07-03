import os
from typing import List, Optional
from fastapi import FastAPI, Header, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel
from dotenv import load_dotenv

from sieweb_client import SieWebClient, Mensaje, MensajeDetalle, Adjunto

# Load environment variables
load_dotenv()

# Configuration from environment
SCHOOL_NAME = os.getenv("SIEWEB_SCHOOL", "santarosadelima")
USERNAME = os.getenv("SIEWEB_USER")
PASSWORD = os.getenv("SIEWEB_PASS")
API_KEY = os.getenv("HERMES_API_KEY", "default_hermes_key_change_me")

if not USERNAME or not PASSWORD:
    print("[WARNING] SIEWEB_USER and SIEWEB_PASS are not set. The server will require login credentials to be set before calling APIs.")

# Initialize SieWebClient instance
client = SieWebClient(school_name=SCHOOL_NAME, username=USERNAME, password=PASSWORD)

app = FastAPI(
    title="Hermes SieWeb API Bridge",
    description="Bridge API to expose SieWeb school messages to the Hermes bot",
    version="1.0.0"
)

# Dependency to check API key
def verify_api_key(x_api_key: str = Header(..., alias="X-API-Key")):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API Key")

# Helper to ensure client is logged in
def ensure_authenticated():
    if not client.token:
        print("[API] No active token found. Initiating login...")
        if not client.login():
            raise HTTPException(status_code=401, detail="Authentication with SieWeb portal failed. Check server credentials.")

class StatusResponse(BaseModel):
    status: str
    school: str
    username: str

@app.get("/status", response_model=StatusResponse, dependencies=[Depends(verify_api_key)])
def get_status():
    """
    Returns the server status and configured school/user.
    """
    return {
        "status": "online",
        "school": client.school_name,
        "username": client.username or "Not configured"
    }

@app.get("/mensajes", response_model=List[Mensaje], dependencies=[Depends(verify_api_key)])
def list_messages(limit: int = 20, folder_id: int = 1, only_unread: bool = False):
    """
    Lists messages from the inbox.
    """
    ensure_authenticated()
    try:
        mensajes = client.get_mensajes(limit=limit, folder_id=folder_id, only_unread=only_unread)
        return mensajes
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/mensajes/{message_id}", response_model=MensajeDetalle, dependencies=[Depends(verify_api_key)])
def get_message_detail(message_id: int, folder_id: int = 1):
    """
    Retrieves complete details of a message by its ID.
    """
    ensure_authenticated()
    detail = client.get_mensaje_detalle(message_id=message_id, folder_id=folder_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Message not found")
    return detail

@app.get("/mensajes/{message_id}/adjuntos/{attachment_id}", dependencies=[Depends(verify_api_key)])
def download_attachment(message_id: int, attachment_id: int):
    """
    Downloads an attachment binary payload.
    """
    ensure_authenticated()
    
    # First get message details to fetch the filename
    detail = client.get_mensaje_detalle(message_id=message_id)
    filename = "attachment"
    if detail and detail.adjuntos:
        for adj in detail.adjuntos:
            if adj.id_adjunto == attachment_id:
                filename = adj.nombre
                break
                
    try:
        content = client.download_attachment(attachment_id=attachment_id)
        # Return raw bytes with appropriate content disposition
        return Response(
            content=content,
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")

@app.post("/mensajes/{message_id}/leer", dependencies=[Depends(verify_api_key)])
def mark_message_as_read(message_id: int, folder_id: int = 1, original_folder_id: int = 1, read: bool = True):
    """
    Marks a message as read or unread.
    """
    ensure_authenticated()
    success = client.marcar_leido(message_id=message_id, folder_id=folder_id, original_folder_id=original_folder_id, read=read)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update message status on SieWeb")
    return {"message": "Status updated successfully"}
