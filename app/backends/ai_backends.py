"""
Concrete back‑end factories for ai_service.

Backend: Amazon Nova (Bedrock runtime) – supports both buffered
InvokeModel and streamed converse_stream calls.
"""

from __future__ import annotations

import json
import logging
import os
from typing import AsyncGenerator, Optional, Dict, Any

import aioboto3
from botocore.exceptions import ClientError

# --------------------------------------------------------------------------- #
# Configurable defaults (override via environment variables if desired)
# --------------------------------------------------------------------------- #
_REGION      = os.getenv("AWS_REGION", "us-east-1")
_MODEL_ID    = os.getenv("NOVA_MODEL_ID", "amazon.nova-lite-v1:0")
_MAX_TOKENS  = int(os.getenv("NOVA_MAX_TOKENS", "512"))
_TEMPERATURE = float(os.getenv("NOVA_TEMPERATURE", "0.5"))
_TOP_P       = float(os.getenv("NOVA_TOP_P", "0.9"))
_DEFAULT_SYS = "You are a helpful assistant."

# Bedrock requires this constant value for chat payloads
_SCHEMA_VERSION = "messages-v1"


# --------------------------------------------------------------------------- #
# Factory – returns an object that satisfies ai_service._AIBackend protocol
# --------------------------------------------------------------------------- #
def get_nova_backend():
    class NovaAI:
        _log = logging.getLogger("ai_service.nova")

        # Held across invocations to reuse TCP connections
        _session: Optional[aioboto3.Session] = None
        _client_cm = None        # async context‑manager returned by aioboto3.client
        _client    = None        # resolved Bedrock client

        # --------------------------- life‑cycle --------------------------- #
        async def init(self) -> None:
            """Create Bedrock client once per container lifetime (idempotent)."""
            if self._client:
                return

            try:
                self._session   = aioboto3.Session()
                self._client_cm = self._session.client(
                    "bedrock-runtime", region_name=_REGION
                )
                self._client = await self._client_cm.__aenter__()
                self._log.info("Connected to Bedrock runtime (%s)", _REGION)
            except ClientError as exc:
                self._log.error("Failed to initialise Bedrock client: %s", exc)
                raise RuntimeError("Failed to connect to Bedrock API") from exc

        async def close(self) -> None:
            """Graceful connector shutdown (safe to call multiple times)."""
            if self._client_cm:
                await self._client_cm.__aexit__(None, None, None)
                self._client_cm = self._client = None

        # ------------------------------- chat ----------------------------- #
        async def chat(
            self,
            prompt: str,
            *,
            stream: bool = False,
            system_role: str | None = None,
            model_id: str | None = None,
            max_tokens: int | None = None,
            temperature: float | None = None,
            top_p: float | None = None,
        ) -> str | AsyncGenerator[str, None]:
            """
            Unified chat interface.

            • `stream=False` → returns a single string.
            • `stream=True`  → returns an async generator yielding text chunks.
            """
            await self.init()

            model = model_id or _MODEL_ID

            # Build message & system blocks (docs: "messages-v1" schema)
            sys_txt     = system_role or _DEFAULT_SYS
            full_prompt = prompt.strip()

            messages = [
                {
                    "role":    "user",
                    "content": [{"text": full_prompt}],
                }
            ]
            system_block = [{"text": sys_txt}]

            # Bedrock expects *camelCase* keys inside inferenceConfig
            inference_cfg: Dict[str, Any] = {
                "maxTokens":   max_tokens  or _MAX_TOKENS,
                "temperature": temperature or _TEMPERATURE,
                "topP":        top_p       or _TOP_P,
            }

            # -------------------------- streaming ------------------------- #
            if stream:
                try:
                    resp = await self._client.converse_stream(
                        modelId=model,
                        messages=messages,
                        system=system_block,
                        inferenceConfig=inference_cfg,
                        schemaVersion=_SCHEMA_VERSION,
                    )

                    async def _chunks() -> AsyncGenerator[str, None]:
                        async for evt in resp["stream"]:
                            delta = evt.get("contentBlockDelta")
                            if delta and "text" in delta["delta"]:
                                yield delta["delta"]["text"]

                    return _chunks()

                except ClientError as exc:
                    self._log.error("Stream conversation error: %s", exc)
                    raise RuntimeError("Error during stream conversation") from exc

            # ------------------------- non‑streaming ----------------------- #
            try:
                payload = {
                    "schemaVersion":  _SCHEMA_VERSION,
                    "messages":       messages,
                    "system":         system_block,
                    "inferenceConfig": inference_cfg,
                }

                raw = await self._client.invoke_model(
                    modelId=model,
                    body=json.dumps(payload),
                )

                # raw["body"] is an aiohttp StreamReader; read() returns bytes
                body_bytes: bytes = await raw["body"].read()
                resp = json.loads(body_bytes.decode())

                # Current Nova schema (InvokeModel) returns:
                # {
                #   "output": {
                #       "message": {
                #           "role": "assistant",
                #           "content": [{"text": "…"}]
                #       },
                #       …usage…
                #   }
                # }
                try:
                    contents = resp["output"]["message"]["content"]
                    return next(c["text"] for c in contents if "text" in c)
                except (KeyError, StopIteration):
                    # Fall back to older / alt schema
                    if "outputs" in resp and resp["outputs"]:
                        return resp["outputs"][0].get("text", "")
                    # Unknown format – dump for inspection
                    self._log.error("Unexpected response schema: %s", resp)
                    return json.dumps(resp)

            except ClientError as exc:
                self._log.error("InvokeModel error: %s", exc)
                raise RuntimeError("Error invoking the model") from exc

            finally:
                # Ensure the client session is closed to avoid aiohttp warnings
                await self.close()

    # end class NovaAI
    return NovaAI()
