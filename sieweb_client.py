import json
import logging
from typing import List, Optional
import requests
from pydantic import BaseModel, Field

# Setup basic logging
logger = logging.getLogger("sieweb_client")

class Mensaje(BaseModel):
    id_mensaje: int = Field(..., alias="ID_MENSAJERIA")
    id_msj_carpeta_usuario: int = Field(..., alias="ID_MSJ_CARPETA_USUARIO")
    asunto: str = Field(..., alias="ASUNTO")
    fecha_envio: str = Field(..., alias="FH_ENVIO")
    leido: bool = Field(False)  # Derived from LECTURA (1 = read, null/0 = unread)
    emisor_nombre: str = Field(..., alias="EMISORNOM")
    emisor_codigo: str = Field(..., alias="USUCOD")
    tiene_adjunto: bool = Field(False)  # Derived from ADJUNTO (1 = has attachments, 0 = no)
    original_folder_id: int = Field(..., alias="ID_MSJ_CARPETA_ORI")

class Destinatario(BaseModel):
    usuario_codigo: str = Field(..., alias="USUCOD")
    tipo: str = Field(..., alias="TIPO")
    usuario_nombre: str = Field(..., alias="USUNOM")
    leido: bool = Field(..., alias="LECTURA")  # 1 = read, 0 = unread
    fecha_lectura: Optional[str] = Field(None, alias="FH_LECTURA")

class Adjunto(BaseModel):
    id_adjunto: int = Field(..., alias="ID_MSJ_ADJUNTO")
    nombre: str = Field(..., alias="NOMBRE")
    extension: str = Field(..., alias="EXTENSION")
    url_relativa: str = Field(..., alias="ADJUNTO")
    es_enlace: bool = Field(False, alias="esEnlace")

class MensajeDetalle(BaseModel):
    id_mensaje: int = Field(..., alias="ID_MENSAJERIA")
    asunto: str = Field(..., alias="ASUNTO")
    fecha_envio: str = Field(..., alias="FH_ENVIO")
    emisor_nombre: str = Field(..., alias="USUNOM")
    emisor_codigo: str = Field(..., alias="USUCOD")
    contenido_html: str = Field(..., alias="MENSAJE")
    referencia_alumno: Optional[str] = Field(None, alias="REFERENCIA_ALUMNO")
    destinatarios: List[Destinatario] = Field(default_factory=list)
    adjuntos: List[Adjunto] = Field(default_factory=list)

class SieWebClient:
    """
    Programmatic HTTP client for SieWeb portals.
    Does not use browser automation.
    """
    def __init__(self, school_name: str = "santarosadelima", username: Optional[str] = None, password: Optional[str] = None):
        self.school_name = school_name.strip().lower()
        self.username = username
        self.password = password
        
        # Base urls
        self.base_url = f"https://{self.school_name}.sieweb.com.pe/lms"
        
        # Requests session to persist session cookies (e.g. XSIE_SESSION)
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*"
        })
        
        self.token: Optional[str] = None
        self.refresh_token_str: Optional[str] = None
        self.usucod: Optional[str] = None

    def login(self, username: Optional[str] = None, password: Optional[str] = None) -> bool:
        """
        Authenticate with the SieWeb portal and retrieve API session tokens.
        """
        if username:
            self.username = username
        if password:
            self.password = password

        if not self.username or not self.password:
            raise ValueError("Username and password must be provided.")

        login_url = f"{self.base_url}/api/login/Ingresar"
        payload = {
            "user": self.username,
            "pass": self.password,
            "token": "",
            "isMobil": False
        }

        logger.info(f"Attempting login for user: {self.username}...")
        try:
            response = self.session.post(login_url, json=payload)
            if response.status_code != 200:
                logger.error(f"Login request failed with status: {response.status_code}")
                return False
            
            data = response.json()
            json_response = data.get("json", {})
            
            if "error" in json_response:
                error_msg = json_response.get("message", "Unknown error")
                logger.error(f"Authentication failed: {error_msg}")
                return False
                
            self.token = json_response.get("token")
            self.refresh_token_str = json_response.get("refreshToken")
            self.usucod = json_response.get("infoColegio", {}).get("usucod")
            
            if not self.token or not self.usucod:
                logger.error("Login succeeded but token or usucod was not returned.")
                return False
                
            # Update session headers with the SieWeb auth headers
            self.session.headers.update({
                "sie-token": self.token,
                "x-usucod": self.usucod
            })
            logger.info("Login successful. Authentication headers updated.")
            return True
            
        except Exception as e:
            logger.error(f"Error during login: {e}")
            return False

    def refresh_session(self) -> bool:
        """
        Refreshes the current authentication token using the refresh token.
        """
        if not self.refresh_token_str:
            logger.warning("No refresh token available to refresh session.")
            return False

        refresh_url = f"{self.base_url}/api/login/refresh"
        payload = {
            "token": self.refresh_token_str,
            "modulo": "intranet",
            "isMobil": False
        }
        
        logger.info("Refreshing SieWeb session token...")
        try:
            response = self.session.post(refresh_url, json=payload)
            if response.status_code != 200:
                logger.warning(f"Token refresh request failed with status: {response.status_code}")
                return False
                
            data = response.json()
            json_response = data.get("json", {})
            
            self.token = json_response.get("token")
            self.refresh_token_str = json_response.get("refreshToken")
            
            if not self.token:
                logger.warning("Token refresh succeeded but no token was returned.")
                return False
                
            # Update headers
            self.session.headers.update({
                "sie-token": self.token
            })
            logger.info("Session token refreshed successfully.")
            return True
            
        except Exception as e:
            logger.error(f"Error during token refresh: {e}")
            return False

    def _request_with_retry(self, method: str, url: str, **kwargs) -> requests.Response:
        """
        Wrapper around requests that detects token expiration (401/403) and 
        performs automatic token refresh or re-login before retrying the request.
        """
        response = self.session.request(method, url, **kwargs)
        
        if response.status_code in (401, 403):
            logger.info("Received unauthorized/forbidden status. Attempting to refresh token...")
            if self.refresh_session():
                # Retry request with new token
                logger.info("Retrying request with refreshed token...")
                response = self.session.request(method, url, **kwargs)
            else:
                logger.info("Token refresh failed. Attempting full re-login...")
                if self.login():
                    logger.info("Retrying request after full re-login...")
                    response = self.session.request(method, url, **kwargs)
                else:
                    logger.error("Auto re-login failed. Returning unauthorized response.")
                    
        return response

    def get_mensajes(self, limit: int = 50, folder_id: int = 1, only_unread: bool = False) -> List[Mensaje]:
        """
        Retrieves the list of messages from the specified folder.
        
        Args:
            limit: Maximum number of messages to retrieve.
            folder_id: Folder index (1: Recibidos, 2: Enviados, 3: Papelera, 4: Archivados).
            only_unread: If True, only returns unread messages.
        """
        messages_url = f"{self.base_url}/api/HyoMensajeria/obtMensajes"
        
        retrieved_messages = []
        segment = 0
        
        while len(retrieved_messages) < limit:
            params = {
                "idCarpeta": folder_id
            }
            if segment > 0:
                params["segmento"] = segment
                
            if only_unread:
                # Axios serializes nested filter objects as a JSON string
                params["filter"] = json.dumps({"lectura": "noLeido"})
                
            logger.info(f"Fetching messages segment {segment} (retrieved so far: {len(retrieved_messages)})...")
            response = self._request_with_retry("GET", messages_url, params=params)
            
            if response.status_code != 200:
                logger.error(f"Failed to fetch messages list (status: {response.status_code})")
                break
                
            data = response.json()
            messages_list = data.get("json", [])
            
            if not messages_list:
                # No more messages available
                break
                
            for msg_data in messages_list:
                # Map raw properties
                # Attachment is 1 if True, 0 or null if False
                has_adj = msg_data.get("ADJUNTO") == 1
                # Read is True if LECTURA is 1, False if null or 0
                lectura_val = msg_data.get("LECTURA")
                is_read = lectura_val == 1
                
                try:
                    mensaje = Mensaje(
                        ID_MENSAJERIA=msg_data["ID_MENSAJERIA"],
                        ID_MSJ_CARPETA_USUARIO=msg_data["ID_MSJ_CARPETA_USUARIO"],
                        ASUNTO=msg_data["ASUNTO"],
                        FH_ENVIO=msg_data["FH_ENVIO"],
                        EMISORNOM=msg_data["EMISORNOM"],
                        USUCOD=msg_data["USUCOD"],
                        ID_MSJ_CARPETA_ORI=msg_data["ID_MSJ_CARPETA_ORI"]
                    )
                    mensaje.leido = is_read
                    mensaje.tiene_adjunto = has_adj
                    retrieved_messages.append(mensaje)
                except Exception as ex:
                    logger.warning(f"Error parsing message data: {ex}. Data: {msg_data}")
                    
                if len(retrieved_messages) >= limit:
                    break
                    
            segment += 1
            
        return retrieved_messages[:limit]

    def get_mensaje_detalle(self, message_id: int, folder_id: int = 1) -> Optional[MensajeDetalle]:
        """
        Retrieves the complete content of a specific message.
        """
        detail_url = f"{self.base_url}/api/HyoMensajeria/obtDetalle"
        params = {
            "carpeta": folder_id,
            "idMensaje": message_id
        }
        
        logger.info(f"Retrieving detail for message ID: {message_id}...")
        response = self._request_with_retry("GET", detail_url, params=params)
        
        if response.status_code != 200:
            logger.error(f"Failed to fetch message details (status: {response.status_code})")
            return None
            
        data = response.json()
        mensaje_data = data.get("mensaje")
        destinatarios_list = data.get("destinatarios", [])
        
        if not mensaje_data:
            logger.error(f"No message data returned for message ID: {message_id}")
            return None
            
        try:
            destinatarios = []
            for dest in destinatarios_list:
                dest_read = dest.get("LECTURA") == 1
                try:
                    destinatario = Destinatario(
                        USUCOD=dest["USUCOD"],
                        TIPO=dest["TIPO"],
                        USUNOM=dest["USUNOM"],
                        LECTURA=dest_read,
                        FH_LECTURA=dest.get("FH_LECTURA")
                    )
                    destinatarios.append(destinatario)
                except Exception as ex:
                    logger.warning(f"Error parsing recipient data: {ex}")

            detalle = MensajeDetalle(
                ID_MENSAJERIA=mensaje_data["ID_MENSAJERIA"],
                ASUNTO=mensaje_data["ASUNTO"],
                FH_ENVIO=mensaje_data["FH_ENVIO"],
                USUNOM=mensaje_data["USUNOM"],
                USUCOD=mensaje_data["USUCOD"],
                MENSAJE=mensaje_data["MENSAJE"],
                REFERENCIA_ALUMNO=mensaje_data.get("REFERENCIA_ALUMNO")
            )
            
            # Parse attachments
            adjuntos_list = mensaje_data.get("ADJUNTO")
            adjuntos = []
            if isinstance(adjuntos_list, list):
                for adj in adjuntos_list:
                    try:
                        adjunto = Adjunto(
                            ID_MSJ_ADJUNTO=adj["ID_MSJ_ADJUNTO"],
                            NOMBRE=adj["NOMBRE"],
                            EXTENSION=adj["EXTENSION"],
                            ADJUNTO=adj["ADJUNTO"],
                            esEnlace=adj.get("esEnlace", False)
                        )
                        adjuntos.append(adjunto)
                    except Exception as ex:
                        logger.warning(f"Error parsing attachment data: {ex}")
            
            detalle.destinatarios = destinatarios
            detalle.adjuntos = adjuntos
            return detalle
            
        except Exception as e:
            logger.error(f"Error compiling message detail: {e}")
            return None

    def download_attachment(self, attachment_id: int) -> bytes:
        """
        Downloads the raw binary content of a message attachment by its ID.
        """
        url = f"{self.base_url}/api/HyoMsjAdjunto/archivo/{attachment_id}?access_token={self.token}"
        logger.info(f"Downloading attachment ID {attachment_id}...")
        response = self._request_with_retry("GET", url)
        
        if response.status_code == 200:
            return response.content
        else:
            raise RuntimeError(f"Failed to download attachment ID {attachment_id} (status: {response.status_code})")

    def marcar_leido(self, message_id: int, folder_id: int = 1, original_folder_id: int = 1, read: bool = True) -> bool:
        """
        Marks a message as read or unread on the server.
        """
        url = f"{self.base_url}/api/HyoMsjusuariotipo/cambiarLectura"
        payload = {
            "idMensaje": message_id,
            "idActual": folder_id,
            "idOri": original_folder_id,
            "lectura": read
        }
        
        logger.info(f"Marking message {message_id} as {'read' if read else 'unread'}...")
        response = self._request_with_retry("POST", url, json=payload)
        
        if response.status_code == 200:
            res_data = response.json()
            if res_data.get("json", {}).get("mensaje") == "m0001":
                return True
        logger.warning(f"Failed to update message read status. Response: {response.text}")
        return False
